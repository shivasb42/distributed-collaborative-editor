"use client";

import { useEffect, useRef, useState, useCallback } from "react";

// Generate random colors for user avatars
const COLORS = [
  "#ef4444", "#f97316", "#f59e0b", "#84cc16", "#22c55e",
  "#14b8a6", "#06b6d4", "#3b82f6", "#6366f1", "#8b5cf6",
  "#a855f7", "#d946ef", "#ec4899", "#f43f5e",
];

// Generate random names
const ADJECTIVES = ["Swift", "Clever", "Brave", "Calm", "Kind", "Quick", "Bold", "Wise"];
const ANIMALS = ["Fox", "Owl", "Bear", "Wolf", "Deer", "Hawk", "Lion", "Tiger"];

function generateUserName(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  return `${adj} ${animal}`;
}

function generateUserColor(): string {
  return COLORS[Math.floor(Math.random() * COLORS.length)];
}

export interface UserPresence {
  id: string;
  name: string;
  color: string;
  cursorPosition: number | null;
  selectionStart: number | null;
  selectionEnd: number | null;
  isEditing: boolean;
  editingField: "title" | "content" | null;
  lastActivity: number;
}

type PresenceMessage =
  | { type: "presence-announce"; user: UserPresence }
  | { type: "presence-update"; user: UserPresence }
  | { type: "presence-leave"; userId: string }
  | { type: "presence-request"; requesterId: string };

interface UsePresenceOptions {
  documentId: string | null;
  enabled?: boolean;
}

export function usePresence({ documentId, enabled = true }: UsePresenceOptions) {
  const channelRef = useRef<BroadcastChannel | null>(null);
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // Initialize user from localStorage or create new
  const [currentUser] = useState<UserPresence>(() => {
    if (typeof window === "undefined") {
      return {
        id: "",
        name: "",
        color: "",
        cursorPosition: null,
        selectionStart: null,
        selectionEnd: null,
        isEditing: false,
        editingField: null,
        lastActivity: Date.now(),
      };
    }
    
    const stored = localStorage.getItem("user-presence");
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        return {
          ...parsed,
          cursorPosition: null,
          selectionStart: null,
          selectionEnd: null,
          isEditing: false,
          editingField: null,
          lastActivity: Date.now(),
        };
      } catch {
        // Fall through to create new user
      }
    }
    
    const newUser: UserPresence = {
      id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: generateUserName(),
      color: generateUserColor(),
      cursorPosition: null,
      selectionStart: null,
      selectionEnd: null,
      isEditing: false,
      editingField: null,
      lastActivity: Date.now(),
    };
    
    localStorage.setItem("user-presence", JSON.stringify({
      id: newUser.id,
      name: newUser.name,
      color: newUser.color,
    }));
    
    return newUser;
  });
  
  const [localPresence, setLocalPresence] = useState<UserPresence>(currentUser);
  const [remoteUsers, setRemoteUsers] = useState<Map<string, UserPresence>>(new Map());
  
  // Broadcast presence update
  const broadcastPresence = useCallback((presence: UserPresence) => {
    if (channelRef.current) {
      const message: PresenceMessage = {
        type: "presence-update",
        user: presence,
      };
      channelRef.current.postMessage(message);
    }
  }, []);
  
  // Update cursor position
  const updateCursor = useCallback((position: number | null, field: "title" | "content" | null) => {
    setLocalPresence(prev => {
      const updated = {
        ...prev,
        cursorPosition: position,
        editingField: field,
        isEditing: position !== null,
        lastActivity: Date.now(),
      };
      broadcastPresence(updated);
      return updated;
    });
  }, [broadcastPresence]);
  
  // Update selection
  const updateSelection = useCallback((start: number | null, end: number | null, field: "title" | "content" | null) => {
    setLocalPresence(prev => {
      const updated = {
        ...prev,
        selectionStart: start,
        selectionEnd: end,
        editingField: field,
        isEditing: start !== null,
        lastActivity: Date.now(),
      };
      broadcastPresence(updated);
      return updated;
    });
  }, [broadcastPresence]);
  
  // Mark as not editing (blur)
  const clearEditing = useCallback(() => {
    setLocalPresence(prev => {
      const updated = {
        ...prev,
        cursorPosition: null,
        selectionStart: null,
        selectionEnd: null,
        isEditing: false,
        editingField: null,
        lastActivity: Date.now(),
      };
      broadcastPresence(updated);
      return updated;
    });
  }, [broadcastPresence]);
  
  // Initialize presence channel
  useEffect(() => {
    if (!enabled || !documentId) return;
    
    const channelName = `presence-${documentId}`;
    const channel = new BroadcastChannel(channelName);
    channelRef.current = channel;
    
    // Handle incoming messages
    channel.onmessage = (event: MessageEvent<PresenceMessage>) => {
      const message = event.data;
      
      switch (message.type) {
        case "presence-announce":
        case "presence-update":
          if (message.user.id !== currentUser.id) {
            setRemoteUsers(prev => {
              const updated = new Map(prev);
              updated.set(message.user.id, {
                ...message.user,
                lastActivity: Date.now(),
              });
              return updated;
            });
          }
          break;
          
        case "presence-leave":
          setRemoteUsers(prev => {
            const updated = new Map(prev);
            updated.delete(message.userId);
            return updated;
          });
          break;
          
        case "presence-request":
          // Someone is asking for all presence info
          if (message.requesterId !== currentUser.id) {
            broadcastPresence(localPresence);
          }
          break;
      }
    };
    
    // Announce ourselves
    const announceMessage: PresenceMessage = {
      type: "presence-announce",
      user: localPresence,
    };
    channel.postMessage(announceMessage);
    
    // Request presence from others
    const requestMessage: PresenceMessage = {
      type: "presence-request",
      requesterId: currentUser.id,
    };
    channel.postMessage(requestMessage);
    
    // Heartbeat and cleanup stale users
    heartbeatIntervalRef.current = setInterval(() => {
      // Broadcast presence
      broadcastPresence(localPresence);
      
      // Clean up stale users (not seen in 10 seconds)
      const now = Date.now();
      setRemoteUsers(prev => {
        const updated = new Map(prev);
        let changed = false;
        updated.forEach((user, id) => {
          if (now - user.lastActivity > 10000) {
            updated.delete(id);
            changed = true;
          }
        });
        return changed ? updated : prev;
      });
    }, 3000);
    
    // Cleanup
    return () => {
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
      }
      
      const leaveMessage: PresenceMessage = {
        type: "presence-leave",
        userId: currentUser.id,
      };
      channel.postMessage(leaveMessage);
      
      channel.close();
      channelRef.current = null;
    };
  }, [enabled, documentId, currentUser.id, localPresence, broadcastPresence]);
  
  return {
    currentUser: localPresence,
    remoteUsers: Array.from(remoteUsers.values()),
    updateCursor,
    updateSelection,
    clearEditing,
    totalUsers: remoteUsers.size + 1,
  };
}
