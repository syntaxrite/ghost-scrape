import "../styles/globals.css";

/**
 * Global App wrapper for Next.js.
 * Imports the global CSS and initializes the component.
 */
function MyApp({ Component, pageProps }) {
  return (
    <div className="antialiased text-slate-900">
      <Component {...pageProps} />
    </div>
  );
}

export default MyApp;
