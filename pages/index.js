import { useState } from "react";
import Layout from "../components/Layout";

export default function Home() {
  const [url, setUrl] = useState("");
  const [result, setResult] = useState(null);

  const handleScrape = async () => {
    const key = localStorage.getItem("apiKey");
    const res = await fetch("/api/scrape", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key },
      body: JSON.stringify({ url })
    });
    setResult(await res.json());
  };

  return (
    <Layout title="Home">
      <div className="flex gap-2">
        <input className="border p-2 flex-1" value={url} onChange={e => setUrl(e.target.value)} placeholder="URL..." />
        <button className="bg-blue-600 text-white p-2 rounded" onClick={handleScrape}>Scrape</button>
      </div>
      {result && <pre className="mt-4 p-4 bg-white shadow">{JSON.stringify(result, null, 2)}</pre>}
    </Layout>
  );
}
