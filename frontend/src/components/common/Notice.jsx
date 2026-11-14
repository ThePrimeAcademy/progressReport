// components/common/Notice.jsx
// A shadcn Alert with the icon that matches its tone. Use it for messages
// about a whole card or form: an error that stopped something, a send that
// went through, something that needs attention.
//   <Notice variant="destructive">Could not load students.</Notice>
//   <Notice variant="warning" title="2 exams are waiting" action={<Button …/>}>…</Notice>
import React from 'react';
import { LuCircleAlert, LuCircleCheck, LuInfo, LuTriangleAlert } from 'react-icons/lu';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert';

const ICONS = {
  default: LuInfo,
  destructive: LuCircleAlert,
  success: LuCircleCheck,
  warning: LuTriangleAlert,
};

export function Notice({ variant = 'default', title, action, className, children }) {
  const Icon = ICONS[variant] || LuInfo;
  return (
    <Alert variant={variant} className={className} role={variant === 'destructive' ? 'alert' : 'status'}>
      <Icon aria-hidden="true" />
      {title && <AlertTitle>{title}</AlertTitle>}
      {children && <AlertDescription>{children}</AlertDescription>}
      {action && <AlertAction>{action}</AlertAction>}
    </Alert>
  );
}
