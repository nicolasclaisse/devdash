import Cocoa
import WebKit

// WKWebView subclass that forwards standard macOS keyboard shortcuts
class DevWebView: WKWebView {
    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        guard event.modifierFlags.contains(.command) else { return super.performKeyEquivalent(with: event) }
        switch event.charactersIgnoringModifiers {
        case "c": return NSApp.sendAction(#selector(NSText.copy(_:)),      to: nil, from: self)
        case "v": return NSApp.sendAction(#selector(NSText.paste(_:)),     to: nil, from: self)
        case "x": return NSApp.sendAction(#selector(NSText.cut(_:)),       to: nil, from: self)
        case "a": return NSApp.sendAction(#selector(NSText.selectAll(_:)), to: nil, from: self)
        case "z": return NSApp.sendAction(Selector(("undo:")),             to: nil, from: self)
        default:  return super.performKeyEquivalent(with: event)
        }
    }
}

class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate {
    var window: NSWindow!
    var webView: DevWebView!

    func applicationDidFinishLaunching(_ notification: Notification) {
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1400, height: 900),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "DevDash"
        window.center()
        window.setFrameAutosaveName("DevDash")

        let config = WKWebViewConfiguration()
        webView = DevWebView(frame: window.contentView!.bounds, configuration: config)
        webView.autoresizingMask = [.width, .height]
        webView.navigationDelegate = self
        webView.uiDelegate = self
        window.contentView = webView

        load()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    var baseURL: String {
        ProcessInfo.processInfo.environment["DEVDASH_URL"] ?? "http://localhost:52800"
    }

    func load() {
        let url = URL(string: baseURL)!
        webView.load(URLRequest(url: url))
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        if webView == self.webView { retry() }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if webView == self.webView { retry() }
    }

    func retry() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
            self?.load()
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }

    func applicationWillTerminate(_ notification: Notification) {
        guard let url = URL(string: baseURL + "/shell/shutdown") else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 15
        let sem = DispatchSemaphore(value: 0)
        URLSession.shared.dataTask(with: req) { _, _, _ in sem.signal() }.resume()
        sem.wait()
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let delegate = AppDelegate()
app.delegate = delegate
app.run()
