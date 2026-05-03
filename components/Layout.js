import Head from "next/head";

export default function Layout({ children, title, description }) {
  return (
    <>
      <Head>
        <title>{title || "Ghost Scrape"}</title>
        <meta name="description" content={description || "Web to Markdown"} />
      </Head>
      <nav className="bg-white shadow p-4">
        <div className="max-w-4xl mx-auto flex justify-between">
          <h1 className="text-xl font-bold">Ghost Scrape</h1>
          <div className="space-x-4">
            <a href="/">Home</a>
            <a href="/dashboard">Dashboard</a>
          </div>
        </div>
      </nav>
      <main className="max-w-4xl mx-auto p-4">{children}</main>
    </>
  );
}
