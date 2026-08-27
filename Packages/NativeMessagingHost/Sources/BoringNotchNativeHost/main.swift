import Foundation
import NativeMessagingBridge

let reader = NativeMessageReader(input: .standardInput)
let writer = NativeMessageWriter(output: .standardOutput)
let deliverer = DistributedPlaybackDeliverer()

func report(_ message: String) {
  FileHandle.standardError.write(Data("[native-host] \(message)\n".utf8))
}

deliverer.publishConnection(.connected)
var exitCode = EXIT_SUCCESS

do {
  while let payload = try reader.readPayload() {
    do {
      _ = try NativeMessageCodec.decodePlayback(payload)
      try deliverer.deliver(payload)
      try writer.write(NativeHostReply(ok: true))
    } catch {
      report("rejected message: \(String(describing: error))")
      try writer.write(NativeHostReply(ok: false, code: "INVALID_PLAYBACK_MESSAGE"))
    }
  }
} catch {
  report("framing failure: \(String(describing: error))")
  try? writer.write(NativeHostReply(ok: false, code: "INVALID_NATIVE_FRAME"))
  exitCode = EXIT_FAILURE
}

deliverer.publishConnection(.disconnected)
if exitCode != EXIT_SUCCESS { exit(exitCode) }
