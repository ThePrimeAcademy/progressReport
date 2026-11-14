// components/common/confirm.jsx
// A promise-based confirmation dialog, in place of window.confirm:
//
//   const confirm = useConfirm();
//   if (!(await confirm({ title: 'Delete exam?', description: '…',
//                         confirmLabel: 'Delete', destructive: true }))) return;
//
// One dialog for the whole app, rendered by <ConfirmProvider> near the root.
import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

const ConfirmContext = createContext(null);

export function ConfirmProvider({ children }) {
  const [request, setRequest] = useState(null); // { title, description, confirmLabel, cancelLabel, destructive }
  const resolver = useRef(null);

  const confirm = useCallback((options) => new Promise((resolve) => {
    resolver.current?.(false); // a newer question replaces an unanswered one
    resolver.current = resolve;
    setRequest(options);
  }), []);

  // Both buttons and dismissing the dialog land here; only the first answer counts.
  const settle = useCallback((answer) => {
    resolver.current?.(answer);
    resolver.current = null;
    setRequest(null);
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog open={Boolean(request)} onOpenChange={(open) => { if (!open) settle(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{request?.title}</AlertDialogTitle>
            {request?.description && <AlertDialogDescription>{request.description}</AlertDialogDescription>}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{request?.cancelLabel || 'Cancel'}</AlertDialogCancel>
            <AlertDialogAction
              variant={request?.destructive ? 'destructive' : 'default'}
              onClick={() => settle(true)}
            >
              {request?.confirmLabel || 'Continue'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error('useConfirm must be used inside <ConfirmProvider>');
  return confirm;
}
