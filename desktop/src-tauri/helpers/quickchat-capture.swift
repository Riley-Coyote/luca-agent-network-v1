import AppKit
import ScreenCaptureKit

@main
struct QuickChatCapture {
    @MainActor
    static func main() async {
        // Standalone helpers must establish an AppKit/WindowServer connection
        // before ScreenCaptureKit creates its capture surface.
        let application = NSApplication.shared
        application.setActivationPolicy(.prohibited)
        application.finishLaunching()
        do {
            guard #available(macOS 14.0, *) else { throw CaptureError.message("App capture requires macOS 14 or later") }
            guard CommandLine.arguments.count == 3, let pid = Int32(CommandLine.arguments[1]) else { throw CaptureError.message("Missing app identity") }
            let title = CommandLine.arguments[2]
            let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true)
            let matches = content.windows.filter { $0.owningApplication?.processID == pid && $0.title == title && $0.frame.width > 0 && $0.frame.height > 0 }
            guard matches.count == 1, let window = matches.first else { throw CaptureError.message("Cannot uniquely identify the Luca window; keep it visible and retry") }
            let config = SCStreamConfiguration()
            let scale = min(2, 2000 / max(window.frame.width, 1))
            config.width = max(1, Int(window.frame.width * scale))
            config.height = max(1, Int(window.frame.height * scale))
            config.showsCursor = false
            config.capturesAudio = false
            config.ignoreShadowsSingleWindow = true
            let image = try await SCScreenshotManager.captureImage(contentFilter: SCContentFilter(desktopIndependentWindow: window), configuration: config)
            guard let data = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) else { throw CaptureError.message("Could not encode captured window") }
            FileHandle.standardOutput.write(data)
        } catch {
            FileHandle.standardError.write(Data("App capture failed: \(error.localizedDescription). Check Screen Recording permission in System Settings.\n".utf8))
            exit(1)
        }
    }
}
enum CaptureError: LocalizedError {
    case message(String)
    var errorDescription: String? { if case .message(let message) = self { return message }; return nil }
}
