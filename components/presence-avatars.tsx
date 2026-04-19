"use client";

import { UserPresence } from "@/hooks/use-presence";

interface PresenceAvatarsProps {
  currentUser: UserPresence;
  remoteUsers: UserPresence[];
  maxDisplay?: number;
}

export function PresenceAvatars({
  currentUser,
  remoteUsers,
  maxDisplay = 5,
}: PresenceAvatarsProps) {
  const allUsers = [currentUser, ...remoteUsers];
  const displayUsers = allUsers.slice(0, maxDisplay);
  const overflowCount = allUsers.length - maxDisplay;

  return (
    <div className="flex items-center">
      {/* Avatars */}
      <div className="flex -space-x-2">
        {displayUsers.map((user, index) => (
          <div
            key={user.id}
            className="relative"
            style={{ zIndex: displayUsers.length - index }}
          >
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-medium border-2 border-background"
              style={{ backgroundColor: user.color }}
              title={`${user.name}${user.id === currentUser.id ? " (you)" : ""}`}
            >
              {user.name.charAt(0)}
            </div>
            {/* Editing indicator */}
            {user.isEditing && (
              <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-green-500 rounded-full border border-background" />
            )}
          </div>
        ))}
        {overflowCount > 0 && (
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium bg-muted text-muted-foreground border-2 border-background"
            style={{ zIndex: 0 }}
          >
            +{overflowCount}
          </div>
        )}
      </div>

      {/* Names on hover tooltip - simplified to just show count */}
      {remoteUsers.length > 0 && (
        <span className="ml-2 text-xs text-muted-foreground hidden sm:inline">
          {remoteUsers.length === 1
            ? `${remoteUsers[0].name} is here`
            : `${remoteUsers.length} others here`}
        </span>
      )}
    </div>
  );
}

interface RemoteCursorsProps {
  remoteUsers: UserPresence[];
  field: "title" | "content";
  containerRef: React.RefObject<HTMLElement | null>;
}

export function RemoteCursors({
  remoteUsers,
  field,
}: RemoteCursorsProps) {
  // Filter to users editing this field
  const activeUsers = remoteUsers.filter(
    (user) => user.editingField === field && user.isEditing
  );

  if (activeUsers.length === 0) return null;

  return (
    <div className="absolute top-0 right-0 flex flex-wrap gap-1 p-1">
      {activeUsers.map((user) => (
        <div
          key={user.id}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs text-white"
          style={{ backgroundColor: user.color }}
        >
          <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
          <span className="font-medium">{user.name.split(" ")[0]}</span>
        </div>
      ))}
    </div>
  );
}

interface EditingIndicatorProps {
  remoteUsers: UserPresence[];
  field: "title" | "content";
}

export function EditingIndicator({ remoteUsers, field }: EditingIndicatorProps) {
  const editingUsers = remoteUsers.filter(
    (user) => user.editingField === field && user.isEditing
  );

  if (editingUsers.length === 0) return null;

  const names = editingUsers.map((u) => u.name.split(" ")[0]);
  const displayNames =
    names.length <= 2
      ? names.join(" and ")
      : `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;

  return (
    <div className="text-xs text-muted-foreground flex items-center gap-1.5">
      <span className="flex -space-x-1">
        {editingUsers.slice(0, 3).map((user) => (
          <span
            key={user.id}
            className="w-4 h-4 rounded-full flex items-center justify-center text-white text-[10px] font-medium border border-background"
            style={{ backgroundColor: user.color }}
          >
            {user.name.charAt(0)}
          </span>
        ))}
      </span>
      <span>
        {displayNames} {editingUsers.length === 1 ? "is" : "are"} editing
      </span>
    </div>
  );
}
