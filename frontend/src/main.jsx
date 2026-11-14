import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ConfirmProvider } from '@/components/common/confirm';
import App from './App.jsx';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Students, programs and exams change rarely and every tab shares them:
      // reuse what is loaded for five minutes instead of refetching per tab.
      staleTime: 5 * 60 * 1000,
      gcTime: 60 * 60 * 1000,
      refetchOnWindowFocus: false,
      // apiClient already retries dropped connections and gateway errors.
      retry: false,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={200}>
        <ConfirmProvider>
          <App />
        </ConfirmProvider>
      </TooltipProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
