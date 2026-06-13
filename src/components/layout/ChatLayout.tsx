"use client";

import { ReactNode, useState } from "react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Menu } from "lucide-react";

type ChatLayoutProps = {
  sidebar: ReactNode;
  children: ReactNode;
};

export default function ChatLayout({ sidebar, children }: ChatLayoutProps) {
  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-64 shrink-0 flex-col border-r border-border">
        {sidebar}
      </aside>

      {/* Mobile sidebar — Sheet */}
      <div className="flex flex-col flex-1 min-w-0">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 bg-background md:hidden">
          <span className="text-xs font-semibold tracking-widest uppercase text-primary">Maxtern</span>
          <Sheet>
            <SheetTrigger className="inline-flex items-center justify-center rounded-lg p-2 hover:bg-muted transition-colors cursor-pointer">
              <Menu className="h-4 w-4" />
            </SheetTrigger>
            <SheetContent side="left" className="w-64 p-0">
              {sidebar}
            </SheetContent>
          </Sheet>
        </div>

        {/* Main content */}
        <main className="flex-1 flex flex-col min-h-0">
          {children}
        </main>
      </div>
    </div>
  );
}
