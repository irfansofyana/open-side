import { useState, type FormEvent } from "react";

import {
  connectToServer,
  type ConnectToServerResult
} from "../lib/runtime/connectionRuntime";

type AppProps = {
  connect?: (input: {
    serverUrl: string;
    email: string;
    password: string;
  }) => Promise<ConnectToServerResult>;
};

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Unable to connect";

export function App({ connect = connectToServer }: AppProps) {
  const [serverUrl, setServerUrl] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();
  const [connection, setConnection] = useState<ConnectToServerResult>();

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsConnecting(true);
    setErrorMessage(undefined);

    try {
      const result = await connect({ serverUrl, email, password });
      setConnection(result);
      setPassword("");
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <main className="panel-shell">
      <header className="top-bar">
        <span className="brand-mark" aria-hidden="true" />
        <span className="brand-name">Open WebUI</span>
      </header>

      {connection ? (
        <section className="connection-panel" aria-labelledby="ready-title">
          <p className="eyebrow">Server</p>
          <h1 id="ready-title">Ready</h1>
          <p className="server-name">{connection.server.displayName}</p>
          <label className="field-label" htmlFor="model">
            Model
          </label>
          <select className="field-control" id="model" name="model">
            {connection.models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name ?? model.id}
              </option>
            ))}
          </select>
        </section>
      ) : (
        <section className="connection-panel" aria-labelledby="connect-server-title">
          <p className="eyebrow">Server</p>
          <h1 id="connect-server-title">Connect server</h1>

          <form className="connection-form" onSubmit={handleSubmit}>
            <label className="field-label" htmlFor="server-url">
              Server URL
            </label>
            <input
              className="field-control"
              id="server-url"
              name="serverUrl"
              onChange={(event) => setServerUrl(event.target.value)}
              required
              type="url"
              value={serverUrl}
            />

            <label className="field-label" htmlFor="email">
              Email or username
            </label>
            <input
              autoComplete="username"
              className="field-control"
              id="email"
              name="email"
              onChange={(event) => setEmail(event.target.value)}
              required
              type="text"
              value={email}
            />

            <label className="field-label" htmlFor="password">
              Password
            </label>
            <input
              autoComplete="current-password"
              className="field-control"
              id="password"
              name="password"
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />

            {errorMessage ? (
              <p className="error-message" role="alert">
                {errorMessage}
              </p>
            ) : null}

            <button type="submit" className="primary-action" disabled={isConnecting}>
              {isConnecting ? "Authenticating..." : "Connect"}
            </button>
          </form>
        </section>
      )}
    </main>
  );
}
