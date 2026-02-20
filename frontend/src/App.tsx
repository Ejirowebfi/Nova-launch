import { Header, Container } from "./components/Layout";
import { Card, ErrorBoundary } from "./components/UI";
import { ConnectButton } from "./components/WalletConnect";
import {
  PWAInstallButton,
  PWAUpdateNotification,
  PWAConnectionStatus,
} from "./components/PWA";

function App() {
  return (
    <ErrorBoundary>
      <a href="#main-content" className="skip-to-main">
        Skip to main content
      </a>
      <div className="min-h-screen bg-gray-50">
        <Header>
          <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-4">
            <PWAConnectionStatus />
            <PWAInstallButton />
            <ConnectButton />
          </div>
        </Header>
        <main id="main-content">
          <Container>
            <Card title="Deploy Your Token">
              <p className="text-gray-600">
                Welcome to Stellar Token Deployer. Connect your wallet to get
                started.
              </p>
            </Card>
          </Container>
        </main>
        <PWAUpdateNotification />
      </div>
    </ErrorBoundary>
  );
}

export default App;
