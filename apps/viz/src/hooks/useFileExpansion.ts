import { useCallback, useRef, useState } from "react";
import { fetchSymbolEdges, fetchSymbolLayout, fetchSymbolNodes } from "../api/client.ts";
import type { ApiEdge, ApiNode, LayoutPositionDto } from "../api/types.ts";

export interface SymbolLevelData {
  nodes: ApiNode[];
  edges: ApiEdge[];
  positions: LayoutPositionDto[];
}

export interface UseFileExpansionResult {
  expandedFiles: ReadonlySet<string>;
  /** Loaded symbol-level data per file (cached; survives collapse/re-expand). */
  symbolData: ReadonlyMap<string, SymbolLevelData>;
  expand: (fileKey: string, filePath: string) => Promise<void>;
  collapse: (fileKey: string) => void;
}

/**
 * The third zoom level (08-04): tracks which FILE nodes are expanded and lazily
 * loads each file's exported-symbol nodes/edges/positions on first expand. Same
 * ref-cached state machine as usePackageExpansion (package→file), one level
 * deeper (file→symbol) — the cache is keyed by the file's graph node key and
 * survives collapse, so re-expand issues zero fetches. `filePath` is the
 * repo-relative path the server scopes symbols by; `fileKey` is the graphology
 * node id (namespaced `package::entity`), used as the cache/expanded-set key.
 */
export function useFileExpansion(): UseFileExpansionResult {
  const [expandedFiles, setExpandedFiles] = useState<ReadonlySet<string>>(new Set());
  const cacheRef = useRef<Map<string, SymbolLevelData>>(new Map());
  const [symbolData, setSymbolData] = useState<ReadonlyMap<string, SymbolLevelData>>(new Map());

  const expand = useCallback(async (fileKey: string, filePath: string): Promise<void> => {
    if (!cacheRef.current.has(fileKey)) {
      const [nodes, edges, positions] = await Promise.all([
        fetchSymbolNodes(filePath),
        fetchSymbolEdges(filePath),
        fetchSymbolLayout(filePath)
      ]);
      cacheRef.current.set(fileKey, { nodes, edges, positions });
      setSymbolData(new Map(cacheRef.current));
    }
    setExpandedFiles((prev) => {
      if (prev.has(fileKey)) {
        return prev;
      }
      const next = new Set(prev);
      next.add(fileKey);
      return next;
    });
  }, []);

  const collapse = useCallback((fileKey: string): void => {
    setExpandedFiles((prev) => {
      if (!prev.has(fileKey)) {
        return prev;
      }
      const next = new Set(prev);
      next.delete(fileKey);
      return next;
    });
  }, []);

  return { expandedFiles, symbolData, expand, collapse };
}
