import type { ReactNode } from 'react';
import { ComercialEscopo } from '@/app/comercial/ComercialDaCarteira';

export default function LayoutDeLeads({ children }: { children: ReactNode }) {
  return <ComercialEscopo>{children}</ComercialEscopo>;
}
