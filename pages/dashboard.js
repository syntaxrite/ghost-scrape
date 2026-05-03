import { useEffect, useState } from "react";
import Layout from "../components/Layout";

export default function Dashboard() {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    const key = localStorage.getItem("apiKey");
    fetch("/api/user/stats", { headers: { "x-api-key": key } })
      .then(r => r.json())
      .then(setStats);
  }, []);

  return (
    <Layout title="Dashboard">
      {stats ? (
        <div className="bg-white p-4 shadow">
          <p>Email: {stats.email}</p>
          <p>Usage: {stats.monthly_used} / {stats.monthly_limit}</p>
          <p className="mt-4 text-xs font-mono">API Key: {localStorage.getItem("apiKey")}</p>
        </div>
      ) : <p>Loading...</p>}
    </Layout>
  );
}
