import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import { api, queryClient } from "./lib/api";
import "./styles.css";
import { MiniApp } from "./tg/MiniApp";
import { Login } from "./web/Login";
import { Shell } from "./web/Shell";

function WebApp() {
  const me = useQuery({ queryKey: ["me"], queryFn: api.me, refetchInterval: false });
  if (me.isLoading) return null;
  if (!me.data?.authenticated) return <Login onDone={() => void me.refetch()} />;
  return <Shell mode={me.data.mode ?? "web"} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/tg/*" element={<MiniApp />} />
          <Route path="/*" element={<WebApp />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
