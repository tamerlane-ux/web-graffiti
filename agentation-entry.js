if (import.meta.env.DEV) {
  Promise.all([
    import("react"),
    import("react-dom/client"),
    import("agentation")
  ]).then(([ReactModule, ReactDOMModule, AgentationModule]) => {
    const host = document.createElement("div");
    host.id = "agentation-root";
    host.dataset.prototypeTool = "agentation";
    document.body.append(host);

    const root = ReactDOMModule.createRoot(host);
    root.render(
      ReactModule.createElement(AgentationModule.Agentation, {
        copyToClipboard: true
      })
    );
  }).catch((error) => {
    console.error("Agentation could not be loaded.", error);
  });
}
