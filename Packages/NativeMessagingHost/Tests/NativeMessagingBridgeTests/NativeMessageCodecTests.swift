import DiscussionTimeline
import Foundation
import XCTest
@testable import NativeMessagingBridge

final class NativeMessageCodecTests: XCTestCase {
  private let validJSON = Data(#"{"schemaVersion":1,"type":"PLAYBACK_STATE","payload":{"videoId":"dQw4w9WgXcQ","currentTime":42.25,"duration":600,"paused":false,"playbackRate":1,"observedAt":"2026-08-27T16:03:42.100Z"}}"#.utf8)

  func testFramingUsesFourByteLittleEndianLength() throws {
    let framed = try NativeMessageCodec.frame(validJSON)
    let length = framed.prefix(4).withUnsafeBytes {
      Int($0.loadUnaligned(as: UInt32.self).littleEndian)
    }
    XCTAssertEqual(length, validJSON.count)
    XCTAssertEqual(try NativeMessageCodec.unframe(framed), validJSON)
  }

  func testDecodesCanonicalPlaybackMessage() throws {
    let envelope = try NativeMessageCodec.decodePlayback(validJSON)
    XCTAssertEqual(envelope.schemaVersion, 1)
    XCTAssertEqual(envelope.payload.videoId, "dQw4w9WgXcQ")
    XCTAssertEqual(envelope.payload.currentTime, 42.25)
  }

  func testRejectsInvalidUTF8AndJSON() {
    assertError(.invalidUTF8) {
      try NativeMessageCodec.decodePlayback(Data([0xff, 0xfe]))
    }
    assertError(.invalidJSON) {
      try NativeMessageCodec.decodePlayback(Data("{not json".utf8))
    }
  }

  func testRejectsUnsupportedVersionAndBadBounds() {
    let version = Data(String(data: validJSON, encoding: .utf8)!.replacingOccurrences(
      of: "\"schemaVersion\":1",
      with: "\"schemaVersion\":2"
    ).utf8)
    assertError(.unsupportedSchemaVersion(2)) {
      try NativeMessageCodec.decodePlayback(version)
    }

    let bounds = Data(String(data: validJSON, encoding: .utf8)!.replacingOccurrences(
      of: "\"currentTime\":42.25",
      with: "\"currentTime\":601"
    ).utf8)
    assertError(.invalidPlayback("time")) {
      try NativeMessageCodec.decodePlayback(bounds)
    }
  }

  func testRejectsOversizedAndTruncatedFramesBeforeDecode() throws {
    assertError(.oversizedPayload(8193)) {
      try NativeMessageCodec.frame(Data(repeating: 0, count: 8193))
    }

    var declared = UInt32(100).littleEndian
    var truncated = withUnsafeBytes(of: &declared) { Data($0) }
    truncated.append(Data(repeating: 0, count: 5))
    assertError(.truncatedPayload(expected: 100, actual: 5)) {
      try NativeMessageCodec.unframe(truncated)
    }
  }

  func testStreamReaderConsumesOneFrameAndThenCleanEOF() throws {
    let pipe = Pipe()
    try pipe.fileHandleForWriting.write(contentsOf: NativeMessageCodec.frame(validJSON))
    try pipe.fileHandleForWriting.close()
    let reader = NativeMessageReader(input: pipe.fileHandleForReading)
    XCTAssertEqual(try reader.readPayload(), validJSON)
    XCTAssertNil(try reader.readPayload())
  }

  func testStreamReaderRejectsTruncatedHeader() throws {
    let pipe = Pipe()
    try pipe.fileHandleForWriting.write(contentsOf: Data([1, 2, 3]))
    try pipe.fileHandleForWriting.close()
    let reader = NativeMessageReader(input: pipe.fileHandleForReading)
    assertError(.truncatedHeader) { try reader.readPayload() }
  }

  func testDecodeAndDeliveryPreparationStayBelowLatencyBudget() throws {
    let clock = ContinuousClock()
    let start = clock.now
    for _ in 0..<1_000 { _ = try NativeMessageCodec.decodePlayback(validJSON) }
    XCTAssertLessThan(start.duration(to: clock.now), .milliseconds(500))
  }

  private func assertError<T>(
    _ expected: NativeMessageError,
    file: StaticString = #filePath,
    line: UInt = #line,
    _ operation: () throws -> T
  ) {
    XCTAssertThrowsError(try operation(), file: file, line: line) { error in
      XCTAssertEqual(error as? NativeMessageError, expected, file: file, line: line)
    }
  }
}
