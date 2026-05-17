import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { Sidebar, ToastProvider, Icon } from "../components/ui";
import { useEffect, useState } from "react";

declare global {
  namespace JSX {
    interface IntrinsicElements {
      's-app-nav': any;
      's-link': any;
    }
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const pendingCount = await prisma.returnRequest.count({
    where: { shop, status: 'PENDING' }
  });

  return { apiKey: process.env.SHOPIFY_API_KEY || "", pendingCount, shop };
};

export default function App() {
  const { apiKey, pendingCount, shop } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isLoading = navigation.state === "loading" || navigation.state === "submitting";

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav style={{ display: 'none' }}>
        <s-link href="/app">Home</s-link>
      </s-app-nav>
      <ToastProvider>
        {/* Global Loading Bar */}
        <div className="fixed top-0 left-0 right-0 h-1 z-[9999] pointer-events-none" style={{ opacity: isLoading ? 1 : 0, transition: 'opacity 0.2s' }}>
          <div className="h-full" style={{ background: '#3d35b5', width: isLoading ? '70%' : '100%', transition: 'width 2s cubic-bezier(0.1, 0.8, 0.3, 1)' }} />
        </div>
        <div className="min-h-screen flex text-ink">
          <Sidebar pendingCount={pendingCount} shop={shop} />
          <main className="flex-1 min-w-0 bg-bg h-screen overflow-y-auto">
            {/* Top bar (mobile) */}
            <div className="md:hidden flex items-center gap-3 h-14 px-4 border-b border-divider bg-surface">
              <div className="w-7 h-7 rounded-md grid place-content-center text-white"
                   style={{ background: 'linear-gradient(135deg,#6C63FF,#8B5CF6)' }}>
                <Icon name="RefreshCcw" size={14} strokeWidth={2.5} />
              </div>
              <div className="font-semibold text-[15px]">ReturnFlow</div>
            </div>
            
            <div className="px-6 md:px-10 py-8 max-w-[1280px] mx-auto">
              <Outlet />
            </div>
          </main>
        </div>
      </ToastProvider>
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
