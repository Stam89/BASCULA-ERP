import { Component, type ErrorInfo, type ReactNode } from "react";

// Si una pantalla falla, React deja la app en blanco y lo escrito se pierde sin explicación. Aquí se ve qué hacer.
export class PantallaError extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) { return { error }; }

  componentDidCatch(error: Error, info: ErrorInfo) { console.error("[pantalla]", error, info.componentStack); }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ maxWidth: 460, margin: "12vh auto", padding: 24, fontFamily: "system-ui, sans-serif", textAlign: "center" }}>
        <div style={{ fontSize: 40 }}>⚠️</div>
        <h2 style={{ margin: "8px 0" }}>Esta pantalla tuvo un problema</h2>
        <p style={{ color: "#475569" }}>Lo que ya estaba guardado sigue a salvo. Recarga la página; si vuelve a pasar, avisa qué estabas haciendo.</p>
        <button type="button" onClick={() => window.location.reload()}
          style={{ padding: "10px 18px", borderRadius: 8, border: "none", background: "#0f766e", color: "#fff", fontWeight: 700, cursor: "pointer" }}>
          Recargar
        </button>
        <p style={{ color: "#94a3b8", fontSize: 12, marginTop: 16, wordBreak: "break-word" }}>{this.state.error.message}</p>
      </div>
    );
  }
}
