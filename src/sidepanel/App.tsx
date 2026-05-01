export function App() {
  return (
    <main className="panel-shell">
      <header className="top-bar">
        <span className="brand-mark" aria-hidden="true" />
        <span className="brand-name">Open WebUI</span>
      </header>

      <section className="connection-panel" aria-labelledby="connect-server-title">
        <p className="eyebrow">Server</p>
        <h1 id="connect-server-title">Connect server</h1>
        <p className="placeholder-copy">
          Add your Open WebUI endpoint here when connection settings land.
        </p>
        <button type="button" className="primary-action">
          Not configured
        </button>
      </section>
    </main>
  );
}
