/* examples/fullstack/react-hono-tanstack/src/client/app.tsx */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MessageList } from "./components/message-list.js";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000 },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <MessageList />
    </QueryClientProvider>
  );
}
