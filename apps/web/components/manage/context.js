// Manage console context — contest + reload + counts, provided by manage/layout.js.
'use client';
import { createContext, useContext } from 'react';

export const ManageContext = createContext(null);

export function useManage() {
  return useContext(ManageContext);
}
