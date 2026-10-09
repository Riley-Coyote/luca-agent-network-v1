// One explicitly granted sample. No permission requests, files, streams, audio,
// keyboard hooks, or diagnostic text containing observed material.
import AppKit
import ApplicationServices
import CryptoKit
import ScreenCaptureKit
import Vision

private let requestProtocol = "polyphonic.awareness.machine-request.v1"
private let replyProtocol = "polyphonic.awareness.machine-reply.v1"
private let maxRequestBytes = 8 * 1024
private let maxReplyBytes = 32 * 1024
private let maxNodes = 600
private let supportedTextApps: Set<String> = ["com.apple.TextEdit", "com.apple.Preview"]
private let browserTerms = ["safari", "chrome", "chromium", "firefox", "brave", "vivaldi", "opera", "microsoft.edgemac", "comet", "atlas", "arc", "orion", "duckduckgo", "browser"]
private let sensitiveTerms = ["password", "passphrase", "credential", "private browsing", "incognito", "sign in", "signin", "authentication", "oauth", "seed phrase", "recovery phrase", "secret", "keychain", "authenticator", "wallet"]

private enum ObservationClass: String, Codable { case appMetadata = "app_metadata", accessibilityText = "accessibility_text", screenText = "screen_text" }
private struct Request: Decodable {
    let protocolName: String
    let observationClass: ObservationClass
    let allowedBundleIDs: [String]
    let excludedBundleIDs: [String]
    let excludedTitleTerms: [String]
    let maxTextBytes: Int
    enum CodingKeys: String, CodingKey {
        case protocolName = "protocol", observationClass = "observation_class"
        case allowedBundleIDs = "allowed_bundle_ids", excludedBundleIDs = "excluded_bundle_ids"
        case excludedTitleTerms = "excluded_title_terms", maxTextBytes = "max_text_bytes"
    }
    static func read() throws -> Request {
        var data = Data()
        while let chunk = try FileHandle.standardInput.read(upToCount: maxRequestBytes - data.count + 1), !chunk.isEmpty {
            guard data.count + chunk.count <= maxRequestBytes else { throw Failure.invalidRequest }
            data.append(chunk)
        }
        guard !data.isEmpty,
              let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              Set(object.keys) == Set(CodingKeys.allNames) else { throw Failure.invalidRequest }
        let value = try JSONDecoder().decode(Request.self, from: data)
        guard value.protocolName == requestProtocol, !value.allowedBundleIDs.isEmpty, value.allowedBundleIDs.count <= 16,
              value.excludedBundleIDs.count <= 32, value.excludedTitleTerms.count <= 32,
              (1...16_384).contains(value.maxTextBytes),
              (value.allowedBundleIDs + value.excludedBundleIDs).allSatisfy(validBundleID),
              value.excludedTitleTerms.allSatisfy({ !$0.isEmpty && $0.utf8.count <= 128 && !$0.contains("\0") })
        else { throw Failure.invalidRequest }
        return value
    }
}
private extension Request.CodingKeys {
    static var allNames: [String] { ["protocol", "observation_class", "allowed_bundle_ids", "excluded_bundle_ids", "excluded_title_terms", "max_text_bytes"] }
}
private struct Reply: Encodable {
    let protocolName = replyProtocol
    let observationClass: String
    let status: String
    let reason: String?
    let bundleID: String?
    let displayName: String?
    let windowRef: String?
    let windowScope: String
    let text: String?
    let truncated: Bool
    enum CodingKeys: String, CodingKey {
        case protocolName = "protocol", observationClass = "observation_class", status, reason
        case bundleID = "bundle_id", displayName = "display_name", windowRef = "window_ref"
        case windowScope = "window_scope", text, truncated
    }
}
private enum Failure: Error, Equatable {
    case invalidRequest, permissionUnavailable, excluded, unsupported, unverifiableWindow, changed, noText, bounds
    var reason: String {
        switch self {
        case .invalidRequest: "invalid_request"
        case .permissionUnavailable: "permission_unavailable"
        case .excluded: "excluded_context"
        case .unsupported: "unsupported_context"
        case .unverifiableWindow: "window_scope_unverified"
        case .changed: "window_changed"
        case .noText: "visible_text_unavailable"
        case .bounds: "sample_bound"
        }
    }
}
private func validBundleID(_ value: String) -> Bool {
    !value.isEmpty && value.utf8.count <= 160 && value.unicodeScalars.allSatisfy { CharacterSet.alphanumerics.union(CharacterSet(charactersIn: ".-_" )).contains($0) }
}
private func browser(_ bundle: String) -> Bool { browserTerms.contains { bundle.lowercased().contains($0) } }
private func sensitive(_ value: String, _ request: Request) -> Bool {
    let lower = value.lowercased()
    return (sensitiveTerms + request.excludedTitleTerms.map { $0.lowercased() }).contains { lower.contains($0) }
}
private func credentialText(_ value: String) -> Bool {
    let lower = value.lowercased()
    return ["-----begin private key", "-----begin rsa private key", "openai_api_key", "anthropic_api_key", "aws_secret_access_key", "github_token", "bearer ", "nsec1", "sk-live-", "sk-proj-"].contains { lower.contains($0) }
}
private func bounded(_ value: String, bytes: Int) -> (String, Bool) {
    if value.utf8.count <= bytes { return (value, false) }
    var result = ""
    var count = 0
    for scalar in value.unicodeScalars {
        let piece = String(scalar)
        if count + piece.utf8.count > bytes { break }
        result += piece
        count += piece.utf8.count
    }
    return (result, true)
}

@MainActor
private func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else { return nil }
    return value
}
@MainActor
private func element(_ value: CFTypeRef?) -> AXUIElement? {
    guard let value, CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
    return (value as! AXUIElement) // CF type identity checked immediately above.
}
@MainActor
private func point(_ value: CFTypeRef?) -> CGPoint? {
    guard let value, CFGetTypeID(value) == AXValueGetTypeID() else { return nil }
    var result = CGPoint.zero
    return AXValueGetValue(value as! AXValue, .cgPoint, &result) ? result : nil
}
@MainActor
private func size(_ value: CFTypeRef?) -> CGSize? {
    guard let value, CFGetTypeID(value) == AXValueGetTypeID() else { return nil }
    var result = CGSize.zero
    return AXValueGetValue(value as! AXValue, .cgSize, &result) ? result : nil
}

@MainActor
private struct Anchor {
    let application: NSRunningApplication
    let bundle: String
    let window: AXUIElement
    let title: String
    let document: String
    let frame: CGRect
    let reference: String

    static func capture(_ request: Request, _ application: NSRunningApplication, _ bundle: String) throws -> Anchor {
        guard !browser(bundle), supportedTextApps.contains(bundle) else { throw Failure.unsupported }
        guard AXIsProcessTrusted() else { throw Failure.permissionUnavailable }
        let app = AXUIElementCreateApplication(application.processIdentifier)
        AXUIElementSetMessagingTimeout(app, 0.15)
        guard let window = element(attribute(app, kAXFocusedWindowAttribute)),
              let title = attribute(window, kAXTitleAttribute) as? String,
              let document = attribute(window, kAXDocumentAttribute) as? String,
              let url = URL(string: document), url.isFileURL,
              let origin = point(attribute(window, kAXPositionAttribute)),
              let extent = size(attribute(window, kAXSizeAttribute)), origin.x.isFinite, origin.y.isFinite,
              extent.width.isFinite, extent.height.isFinite, extent.width > 0, extent.height > 0,
              extent.width <= 20_000, extent.height <= 20_000,
              !sensitive(title, request), !sensitive(url.path, request),
              ![".env", "credentials", "secrets", "id_rsa", "id_ed25519"].contains(url.lastPathComponent.lowercased()),
              !["pem", "key"].contains(url.pathExtension.lowercased())
        else { throw Failure.unverifiableWindow }
        let identifier = "\(application.processIdentifier)\0\(title)\0\(document)"
        let reference = "sha256:" + SHA256.hash(data: Data(identifier.utf8)).map { String(format: "%02x", $0) }.joined()
        let anchor = Anchor(application: application, bundle: bundle, window: window, title: title, document: document, frame: CGRect(origin: origin, size: extent), reference: reference)
        try anchor.preflight(request)
        return anchor
    }
    func preflight(_ request: Request) throws {
        guard AXIsProcessTrusted(), NSWorkspace.shared.frontmostApplication?.processIdentifier == application.processIdentifier else { throw Failure.changed }
        let app = AXUIElementCreateApplication(application.processIdentifier)
        guard let focused = element(attribute(app, kAXFocusedWindowAttribute)), CFEqual(focused, window),
              attribute(window, kAXTitleAttribute) as? String == title,
              attribute(window, kAXDocumentAttribute) as? String == document,
              let input = element(attribute(app, kAXFocusedUIElementAttribute))
        else { throw Failure.changed }
        let focusRole = attribute(input, kAXRoleAttribute) as? String
        let focusSubrole = attribute(input, kAXSubroleAttribute) as? String
        guard focusRole != nil else { throw Failure.unverifiableWindow }
        if focusRole == "AXSecureTextField" || focusSubrole == "AXSecureTextField" { throw Failure.excluded }
        _ = try inspectTree(request)
    }
    func inspectTree(_ request: Request) throws -> [AXUIElement] {
        let began = ContinuousClock.now
        var queue = [window]
        var checked: [AXUIElement] = []
        var cursor = 0
        while cursor < queue.count {
            guard checked.count < maxNodes, began.duration(to: .now) < .seconds(1) else { throw Failure.bounds }
            let node = queue[cursor]
            cursor += 1
            guard let role = attribute(node, kAXRoleAttribute) as? String else { throw Failure.unverifiableWindow }
            let subrole = attribute(node, kAXSubroleAttribute) as? String
            let description = attribute(node, kAXDescriptionAttribute) as? String ?? ""
            if role == "AXSecureTextField" || subrole == "AXSecureTextField" || role == "AXWebArea" || sensitive(description, request) { throw Failure.excluded }
            checked.append(node)
            var childCount = 0
            let countResult = AXUIElementGetAttributeValueCount(node, kAXChildrenAttribute as CFString, &childCount)
            if countResult == .success && childCount > 0 {
                guard childCount <= maxNodes - queue.count else { throw Failure.bounds }
                var children: CFArray?
                guard AXUIElementCopyAttributeValues(node, kAXChildrenAttribute as CFString, 0, childCount, &children) == .success,
                      let values = children as? [AXUIElement], values.count == childCount
                else { throw Failure.unverifiableWindow }
                queue.append(contentsOf: values)
            } else if countResult != .success && countResult != .attributeUnsupported {
                throw Failure.unverifiableWindow
            }
        }
        return checked
    }
    func visibleText(_ request: Request) throws -> (String, Bool) {
        let nodes = try inspectTree(request)
        var output = ""
        var truncated = false
        for node in nodes {
            guard let role = attribute(node, kAXRoleAttribute) as? String,
                  let origin = point(attribute(node, kAXPositionAttribute)),
                  let extent = size(attribute(node, kAXSizeAttribute)),
                  frame.intersects(CGRect(origin: origin, size: extent)) else { continue }
            var text: String?
            if role == "AXStaticText" {
                text = attribute(node, kAXValueAttribute) as? String
            } else if role == "AXTextArea" {
                guard let raw = attribute(node, kAXVisibleCharacterRangeAttribute), CFGetTypeID(raw) == AXValueGetTypeID() else { continue }
                var range = CFRange(location: 0, length: 0)
                guard AXValueGetValue(raw as! AXValue, .cfRange, &range), range.location >= 0, range.length > 0 else { continue }
                range.length = min(range.length, request.maxTextBytes)
                guard let parameter = AXValueCreate(.cfRange, &range) else { continue }
                var value: CFTypeRef?
                if AXUIElementCopyParameterizedAttributeValue(node, kAXStringForRangeParameterizedAttribute as CFString, parameter, &value) == .success { text = value as? String }
            }
            // Never read text-field input values or keyboard events.
            if let text, !text.isEmpty {
                let remaining = request.maxTextBytes - output.utf8.count
                if remaining <= 1 { truncated = true; break }
                let piece = bounded(text, bytes: remaining - 1)
                output += piece.0 + "\n"
                truncated = truncated || piece.1
            }
        }
        guard !output.isEmpty else { throw Failure.noText }
        guard !credentialText(output) else { throw Failure.excluded }
        try preflight(request)
        return (output, truncated)
    }
    @available(macOS 14.0, *)
    func screenText(_ request: Request) async throws -> (String, Bool) {
        guard CGPreflightScreenCaptureAccess() else { throw Failure.permissionUnavailable }
        let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true)
        try preflight(request)
        let windows = content.windows.filter { $0.owningApplication?.processID == application.processIdentifier && $0.title == title && abs($0.frame.width - frame.width) < 3 && abs($0.frame.height - frame.height) < 3 && abs($0.frame.minX - frame.minX) < 3 && abs($0.frame.minY - frame.minY) < 3 }
        guard windows.count == 1, let window = windows.first, CGPreflightScreenCaptureAccess() else { throw Failure.unverifiableWindow }
        let configuration = SCStreamConfiguration()
        let scale = min(1, sqrt(1_000_000 / max(1, frame.width * frame.height)))
        configuration.width = max(1, Int(frame.width * scale))
        configuration.height = max(1, Int(frame.height * scale))
        configuration.showsCursor = false
        configuration.capturesAudio = false
        configuration.ignoreShadowsSingleWindow = true
        let image = try await SCScreenshotManager.captureImage(contentFilter: SCContentFilter(desktopIndependentWindow: window), configuration: configuration)
        try preflight(request)
        let recognition = VNRecognizeTextRequest()
        recognition.recognitionLevel = .fast
        recognition.usesLanguageCorrection = false
        recognition.automaticallyDetectsLanguage = true
        try VNImageRequestHandler(cgImage: image, options: [:]).perform([recognition])
        var output = ""
        var truncated = false
        for observation in recognition.results ?? [] {
            guard let candidate = observation.topCandidates(1).first, candidate.confidence >= 0.6 else { continue }
            let remaining = request.maxTextBytes - output.utf8.count
            if remaining <= 1 { truncated = true; break }
            let piece = bounded(candidate.string, bytes: remaining - 1)
            output += piece.0 + "\n"
            truncated = truncated || piece.1
        }
        guard !output.isEmpty else { throw Failure.noText }
        guard !credentialText(output) else { throw Failure.excluded }
        try preflight(request)
        return (output, truncated)
    }
}

@main
private struct CompanionAwareness {
    @MainActor
    static func main() async {
        let app = NSApplication.shared
        app.setActivationPolicy(.prohibited)
        app.finishLaunching()
        var selectedClass = "unknown"
        do {
            let request = try Request.read()
            selectedClass = request.observationClass.rawValue
            guard CommandLine.arguments.count == 1 || (CommandLine.arguments.count == 2 && CommandLine.arguments[1] == "--activation-signals") else { throw Failure.invalidRequest }
            if CommandLine.arguments.count == 2 {
                guard request.observationClass == .appMetadata else { throw Failure.invalidRequest }
                // This is an event-only dirty notification, not a metadata/text
                // sample. Do not inspect notification userInfo or any app/window.
                let center = NSWorkspace.shared.notificationCenter
                let token = center.addObserver(forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) { _ in
                    FileHandle.standardOutput.write(Data([0x31, 0x0a]))
                }
                defer { center.removeObserver(token) }
                app.run()
                return
            }
            guard let front = NSWorkspace.shared.frontmostApplication, let bundle = front.bundleIdentifier,
                  validBundleID(bundle), request.allowedBundleIDs.contains(bundle),
                  !request.excludedBundleIDs.contains(bundle), !sensitive(bundle, request)
            else { throw Failure.excluded }
            let name = bounded(front.localizedName ?? bundle, bytes: 128).0
            if request.observationClass == .appMetadata {
                // No AX trust is needed for verified bundle/name metadata. Never
                // expose a window title, page/profile, or claim human attention.
                emit(Reply(observationClass: selectedClass, status: "available", reason: "window_scope_unavailable", bundleID: bundle, displayName: name, windowRef: nil, windowScope: "unavailable", text: nil, truncated: false))
                return
            }
            let anchor = try Anchor.capture(request, front, bundle)
            let text: (String, Bool)
            switch request.observationClass {
            case .accessibilityText: text = try anchor.visibleText(request)
            case .screenText:
                guard #available(macOS 14.0, *) else { throw Failure.unsupported }
                text = try await anchor.screenText(request)
            case .appMetadata: throw Failure.invalidRequest
            }
            emit(Reply(observationClass: selectedClass, status: "available", reason: nil, bundleID: bundle, displayName: name, windowRef: anchor.reference, windowScope: "verified_document_window", text: text.0, truncated: text.1))
        } catch {
            let failure = error as? Failure ?? .unverifiableWindow
            emit(Reply(observationClass: selectedClass, status: failure == .excluded ? "excluded" : "unavailable", reason: failure.reason, bundleID: nil, displayName: nil, windowRef: nil, windowScope: "unavailable", text: nil, truncated: false))
        }
    }
    private static func emit(_ reply: Reply) {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        guard let data = try? encoder.encode(reply), data.count <= maxReplyBytes else {
            FileHandle.standardOutput.write(Data("{\"protocol\":\"\(replyProtocol)\",\"observation_class\":\"unknown\",\"status\":\"unavailable\",\"reason\":\"sample_bound\",\"window_scope\":\"unavailable\",\"truncated\":false}".utf8))
            return
        }
        FileHandle.standardOutput.write(data)
    }
}
