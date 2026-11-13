import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import { AppFrame, useSignOut } from "./app/App";
import { PlatformProvider, usePrefsTheme } from "./app/platform";
import { api, queryClient } from "./lib/api";
import "./styles.css";
import { MiniApp } from "./tg/MiniApp";
import { Login } from "./web/Login";

function WebApp() {
  const me = useQuery({ queryKey: ["me"], queryFn: api.me, refetchInterval: false });
  const signOut = useSignOut();
  usePrefsTheme(null, !!me.data?.authenticated);
  if (me.isLoading) return null;
  if (!me.data?.authenticated) return <Login onDone={() => void me.refetch()} />;
  return <AppFrame onSignOut={me.data.mode === "open" ? undefined : () => void signOut()} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/tg/*" element={<MiniApp />} />
          <Route
            path="/*"
            element={
              <PlatformProvider tg={null} base="">
                <WebApp />
              </PlatformProvider>
            }
          />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
