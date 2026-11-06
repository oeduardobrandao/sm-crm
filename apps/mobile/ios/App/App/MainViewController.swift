import UIKit
import WebKit
import Capacitor

/// The app's only screen: Capacitor's bridge view controller with a few web view
/// defaults changed so the live CRM feels like an app rather than a web page.
class MainViewController: CAPBridgeViewController {

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        guard let webView = webView else { return }

        // Long-pressing a link shows Safari's preview with "Open Link" / "Add to
        // Reading List", which takes the user out of the app. Native apps don't do that.
        webView.allowsLinkPreview = false

        // Edge swipe goes back through the CRM's history (React Router pushState
        // entries count), like a navigation controller.
        webView.allowsBackForwardNavigationGestures = true

        // Paint the CRM's own background behind the web view so cold starts and
        // overscroll don't flash white in dark mode. Matches --bg-color in style.css.
        let crmBackground = UIColor { traits in
            traits.userInterfaceStyle == .dark
                ? UIColor(red: 0x0a / 255, green: 0x0c / 255, blue: 0x0f / 255, alpha: 1)
                : UIColor(red: 0xfd / 255, green: 0xfd / 255, blue: 0xfd / 255, alpha: 1)
        }
        view.backgroundColor = crmBackground
        webView.backgroundColor = crmBackground
        webView.scrollView.backgroundColor = crmBackground
    }
}
