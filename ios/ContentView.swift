// ひらがなバランス — iOS ラッパー (Swift Playground / SwiftUI)
// ゲーム本体 (index.html) を「hiragana-balance.html」という名前で
// アプリのリソースに追加して使う。最高記録は WKWebView の localStorage に残る。

import SwiftUI
import WebKit

struct ContentView: View {
    var body: some View {
        GameWebView()
            .background(Color(red: 0.91, green: 0.87, blue: 0.80))
    }
}

struct GameWebView: UIViewRepresentable {
    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.bounces = false

        if let url = gameFileURL() {
            webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        } else {
            webView.loadHTMLString("<p style='font-size:40px;padding:40px'>ゲームのファイルが見つかりません</p>", baseURL: nil)
        }
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    private func gameFileURL() -> URL? {
        for bundle in [Bundle.main] + Bundle.allBundles {
            if let url = bundle.url(forResource: "hiragana-balance", withExtension: "html") {
                return url
            }
        }
        return nil
    }
}
