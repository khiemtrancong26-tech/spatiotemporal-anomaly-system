import { createContext, useContext, type PropsWithChildren } from 'react';
import { createPortal } from 'react-dom';

export const WorkspaceHeaderContext = createContext<HTMLElement | null>(null);

export function WorkspaceHeader({ children }: PropsWithChildren) {
  const host = useContext(WorkspaceHeaderContext);
  return host ? createPortal(children, host) : children;
}
