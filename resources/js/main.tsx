import React, { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from '@/context/theme-provider';
import { Toaster } from 'sonner';

import { KioskPage } from '@/pages/Kiosk/KioskPage';
import { LoginPage } from '@/pages/Hrd/LoginPage';
import { DashboardPage } from '@/pages/Hrd/DashboardPage';
import { EmployeesPage } from '@/pages/Hrd/EmployeesPage';
import { EmployeeDetailPage } from '@/pages/Hrd/EmployeeDetailPage';
import { LogsPage } from '@/pages/Hrd/LogsPage';
import { LogDetailPage } from '@/pages/Hrd/LogDetailPage';
import { SettingsPage } from '@/pages/Hrd/SettingsPage';

function App() {
  return (
    <ThemeProvider defaultTheme="light" storageKey="kiosk-theme">
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/kiosk" replace />} />
          <Route path="/kiosk" element={<KioskPage />} />
          <Route path="/hrd" element={<Navigate to="/hrd/dashboard" replace />} />
          <Route path="/hrd/login" element={<LoginPage />} />
          <Route path="/hrd/dashboard" element={<DashboardPage />} />
          <Route path="/hrd/employees" element={<EmployeesPage />} />
          <Route path="/hrd/employees/:id" element={<EmployeeDetailPage />} />
          <Route path="/hrd/logs" element={<LogsPage />} />
          <Route path="/hrd/logs/:id" element={<LogDetailPage />} />
          <Route path="/hrd/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/kiosk" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster position="top-right" richColors closeButton />
    </ThemeProvider>
  );
}

const rootElement = document.getElementById('root');
if (rootElement) {
  const rootWithInstance = rootElement as HTMLElement & { reactRoot?: Root };
  const reactRoot = rootWithInstance.reactRoot ?? ReactDOM.createRoot(rootElement);
  rootWithInstance.reactRoot = reactRoot;

  reactRoot.render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}
