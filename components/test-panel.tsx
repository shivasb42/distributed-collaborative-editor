"use client";

import { useState } from "react";
import {
  Bug,
  ChevronDown,
  ChevronUp,
  Wifi,
  WifiOff,
  Clock,
  Users,
  Zap,
  RefreshCw,
  Trash2,
  Download,
  Copy,
} from "lucide-react";

interface TestPanelProps {
  documentId: string | null;
  isOnline: boolean;
  connectedTabs: number;
  unsyncedCount: number;
  syncStatus: {
    state: string;
    pendingUpdates: number;
    lastSyncTime: Date | null;
  };
  onSimulateOffline: () => void;
  onSimulateOnline: () => void;
  onForceSync: () => void;
  onClearLocalData: () => void;
  onDuplicateUpdate: () => void;
  getStateVector: () => Uint8Array | null;
}

interface TestLog {
  id: string;
  timestamp: Date;
  type: "info" | "success" | "warning" | "error";
  message: string;
}

export function TestPanel({
  documentId,
  isOnline,
  connectedTabs,
  unsyncedCount,
  syncStatus,
  onSimulateOffline,
  onSimulateOnline,
  onForceSync,
  onClearLocalData,
  onDuplicateUpdate,
  getStateVector,
}: TestPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [logs, setLogs] = useState<TestLog[]>([]);
  const [simulatedDelay, setSimulatedDelay] = useState(0);

  const addLog = (type: TestLog["type"], message: string) => {
    const log: TestLog = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date(),
      type,
      message,
    };
    setLogs((prev) => [...prev.slice(-49), log]);
  };

  const handleSimulateOffline = () => {
    onSimulateOffline();
    addLog("warning", "Simulated offline mode");
  };

  const handleSimulateOnline = () => {
    onSimulateOnline();
    addLog("success", "Back online - triggering sync");
  };

  const handleDelayedReconnect = () => {
    onSimulateOffline();
    addLog("warning", `Simulating ${simulatedDelay}s delayed reconnect`);
    setTimeout(() => {
      onSimulateOnline();
      addLog("success", "Delayed reconnect complete");
    }, simulatedDelay * 1000);
  };

  const handleForceSync = () => {
    onForceSync();
    addLog("info", "Forced sync/reconciliation triggered");
  };

  const handleClearLocalData = () => {
    if (confirm("This will clear all local document data. Continue?")) {
      onClearLocalData();
      addLog("warning", "Local data cleared");
    }
  };

  const handleDuplicateUpdate = () => {
    onDuplicateUpdate();
    addLog("info", "Sent duplicate update to test idempotency");
  };

  const handleCopyStateVector = () => {
    const sv = getStateVector();
    if (sv) {
      const base64 = btoa(String.fromCharCode(...sv));
      navigator.clipboard.writeText(base64);
      addLog("info", `State vector copied (${sv.length} bytes)`);
    }
  };

  const handleOpenNewTab = () => {
    window.open(window.location.href, "_blank");
    addLog("info", "Opened new tab for testing");
  };

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {/* Toggle Button */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 px-3 py-2 bg-zinc-900 text-zinc-100 rounded-lg shadow-lg hover:bg-zinc-800 transition-colors"
      >
        <Bug className="h-4 w-4" />
        <span className="text-sm font-medium">Test Panel</span>
        {isExpanded ? (
          <ChevronDown className="h-4 w-4" />
        ) : (
          <ChevronUp className="h-4 w-4" />
        )}
      </button>

      {/* Panel */}
      {isExpanded && (
        <div className="absolute bottom-12 right-0 w-96 bg-zinc-900 text-zinc-100 rounded-lg shadow-2xl border border-zinc-700 overflow-hidden">
          {/* Header */}
          <div className="px-4 py-3 border-b border-zinc-700 bg-zinc-800">
            <h3 className="font-semibold text-sm">Failure Testing Panel</h3>
            <p className="text-xs text-zinc-400 mt-0.5">
              Test offline mode, reconciliation, and sync
            </p>
          </div>

          {/* Status */}
          <div className="px-4 py-3 border-b border-zinc-700 grid grid-cols-2 gap-3 text-xs">
            <div className="flex items-center gap-2">
              {isOnline ? (
                <Wifi className="h-3.5 w-3.5 text-green-400" />
              ) : (
                <WifiOff className="h-3.5 w-3.5 text-amber-400" />
              )}
              <span>{isOnline ? "Online" : "Offline"}</span>
            </div>
            <div className="flex items-center gap-2">
              <Users className="h-3.5 w-3.5 text-blue-400" />
              <span>{connectedTabs + 1} tabs connected</span>
            </div>
            <div className="flex items-center gap-2">
              <Zap className="h-3.5 w-3.5 text-purple-400" />
              <span>Sync: {syncStatus.state}</span>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="h-3.5 w-3.5 text-orange-400" />
              <span>{unsyncedCount + syncStatus.pendingUpdates} pending</span>
            </div>
          </div>

          {/* Actions */}
          <div className="px-4 py-3 border-b border-zinc-700 space-y-2">
            <p className="text-xs font-medium text-zinc-400 mb-2">
              Scenario Testing
            </p>

            {/* Offline/Online Toggle */}
            <div className="flex gap-2">
              <button
                onClick={handleSimulateOffline}
                disabled={!isOnline}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-amber-600 text-white rounded text-xs font-medium hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <WifiOff className="h-3 w-3" />
                Go Offline
              </button>
              <button
                onClick={handleSimulateOnline}
                disabled={isOnline}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-green-600 text-white rounded text-xs font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Wifi className="h-3 w-3" />
                Go Online
              </button>
            </div>

            {/* Delayed Reconnect */}
            <div className="flex gap-2 items-center">
              <input
                type="number"
                min="1"
                max="30"
                value={simulatedDelay}
                onChange={(e) => setSimulatedDelay(parseInt(e.target.value) || 0)}
                className="w-16 px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-xs text-center"
                placeholder="sec"
              />
              <button
                onClick={handleDelayedReconnect}
                disabled={!isOnline || simulatedDelay <= 0}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Clock className="h-3 w-3" />
                Delayed Reconnect ({simulatedDelay}s)
              </button>
            </div>

            {/* Other Actions */}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={handleForceSync}
                className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-zinc-700 text-white rounded text-xs font-medium hover:bg-zinc-600 transition-colors"
              >
                <RefreshCw className="h-3 w-3" />
                Force Sync
              </button>
              <button
                onClick={handleDuplicateUpdate}
                className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-zinc-700 text-white rounded text-xs font-medium hover:bg-zinc-600 transition-colors"
              >
                <Copy className="h-3 w-3" />
                Dup Update
              </button>
              <button
                onClick={handleOpenNewTab}
                className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-zinc-700 text-white rounded text-xs font-medium hover:bg-zinc-600 transition-colors"
              >
                <Download className="h-3 w-3" />
                Open New Tab
              </button>
              <button
                onClick={handleCopyStateVector}
                className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-zinc-700 text-white rounded text-xs font-medium hover:bg-zinc-600 transition-colors"
              >
                <Copy className="h-3 w-3" />
                Copy State
              </button>
            </div>

            <button
              onClick={handleClearLocalData}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 bg-red-600 text-white rounded text-xs font-medium hover:bg-red-700 transition-colors"
            >
              <Trash2 className="h-3 w-3" />
              Clear All Local Data
            </button>
          </div>

          {/* Logs */}
          <div className="px-4 py-3 max-h-48 overflow-y-auto">
            <p className="text-xs font-medium text-zinc-400 mb-2">Event Log</p>
            {logs.length === 0 ? (
              <p className="text-xs text-zinc-500">No events yet</p>
            ) : (
              <div className="space-y-1">
                {logs
                  .slice()
                  .reverse()
                  .map((log) => (
                    <div key={log.id} className="flex gap-2 text-xs">
                      <span className="text-zinc-500 shrink-0">
                        {log.timestamp.toLocaleTimeString()}
                      </span>
                      <span
                        className={
                          log.type === "success"
                            ? "text-green-400"
                            : log.type === "warning"
                            ? "text-amber-400"
                            : log.type === "error"
                            ? "text-red-400"
                            : "text-zinc-300"
                        }
                      >
                        {log.message}
                      </span>
                    </div>
                  ))}
              </div>
            )}
          </div>

          {/* Doc ID */}
          <div className="px-4 py-2 border-t border-zinc-700 bg-zinc-800">
            <p className="text-xs text-zinc-500 font-mono truncate">
              Doc: {documentId || "loading..."}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
