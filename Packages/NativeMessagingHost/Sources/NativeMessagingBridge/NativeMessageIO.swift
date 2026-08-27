import Foundation

public final class NativeMessageReader: @unchecked Sendable {
  private let input: FileHandle

  public init(input: FileHandle) {
    self.input = input
  }

  /// Returns nil only for a clean EOF before the next frame header.
  public func readPayload() throws -> Data? {
    guard let header = try readExactly(4, allowCleanEOF: true) else { return nil }
    let length = header.withUnsafeBytes { rawBuffer in
      Int(rawBuffer.loadUnaligned(as: UInt32.self).littleEndian)
    }
    guard length <= NativeMessagingConstants.maximumMessageBytes else {
      throw NativeMessageError.oversizedPayload(length)
    }
    return try readExactly(length, allowCleanEOF: false)
  }

  private func readExactly(_ count: Int, allowCleanEOF: Bool) throws -> Data? {
    if count == 0 { return Data() }
    var result = Data()
    while result.count < count {
      let chunk = try input.read(upToCount: count - result.count) ?? Data()
      if chunk.isEmpty {
        if result.isEmpty && allowCleanEOF { return nil }
        if allowCleanEOF { throw NativeMessageError.truncatedHeader }
        throw NativeMessageError.truncatedPayload(expected: count, actual: result.count)
      }
      result.append(chunk)
    }
    return result
  }
}

public final class NativeMessageWriter: @unchecked Sendable {
  private let output: FileHandle

  public init(output: FileHandle) {
    self.output = output
  }

  public func write(_ reply: NativeHostReply) throws {
    try output.write(contentsOf: NativeMessageCodec.encodeReply(reply))
  }
}
