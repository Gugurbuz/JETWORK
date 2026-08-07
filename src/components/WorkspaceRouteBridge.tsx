import React, { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useDataStore } from '../store/useDataStore';
import {
  buildWorkspaceConversationPath,
  parseWorkspaceIdFromPath,
} from '../lib/workspaceRoute';

interface WorkspaceRouteBridgeProps {
  children: React.ReactNode;
}

/**
 * Keeps the browser URL and the in-memory workspace selection in sync.
 *
 * URL is the durable navigation source of truth across refresh/back/forward.
 * Zustand remains the runtime state consumed by the existing application.
 */
export function WorkspaceRouteBridge({ children }: WorkspaceRouteBridgeProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const currentWorkspaceId = useDataStore(state => state.currentWorkspaceId);
  const setCurrentWorkspaceId = useDataStore(state => state.setCurrentWorkspaceId);
  const setCurrentProjectId = useDataStore(state => state.setCurrentProjectId);
  const routeDrivenStoreUpdateRef = useRef(false);

  useEffect(() => {
    const routeWorkspaceId = parseWorkspaceIdFromPath(location.pathname);
    const activeWorkspaceId = useDataStore.getState().currentWorkspaceId;

    if (routeWorkspaceId === activeWorkspaceId) return;

    routeDrivenStoreUpdateRef.current = true;
    setCurrentWorkspaceId(routeWorkspaceId);
    if (routeWorkspaceId) {
      setCurrentProjectId(null);
    }
  }, [location.pathname, setCurrentProjectId, setCurrentWorkspaceId]);

  useEffect(() => {
    if (routeDrivenStoreUpdateRef.current) {
      routeDrivenStoreUpdateRef.current = false;
      return;
    }

    const routeWorkspaceId = parseWorkspaceIdFromPath(window.location.pathname);

    if (currentWorkspaceId) {
      if (routeWorkspaceId !== currentWorkspaceId) {
        navigate(buildWorkspaceConversationPath(currentWorkspaceId));
      }
      return;
    }

    if (routeWorkspaceId) {
      navigate('/');
    }
  }, [currentWorkspaceId, navigate]);

  return <>{children}</>;
}
