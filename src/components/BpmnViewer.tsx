import React, { useEffect, useRef } from 'react';
import BpmnJS from 'bpmn-js/dist/bpmn-viewer.production.min.js';
import { Maximize2, Minimize2, Download } from 'lucide-react';

interface BpmnViewerProps {
  xml: string;
}

export function BpmnViewer({ xml }: BpmnViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<any>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Initialize viewer
    viewerRef.current = new BpmnJS({
      container: containerRef.current
    });

    return () => {
      if (viewerRef.current) {
        viewerRef.current.destroy();
      }
    };
  }, []);

  useEffect(() => {
    const loadDiagram = async () => {
      if (!viewerRef.current || !xml) return;
      
      try {
        await viewerRef.current.importXML(xml);
        const canvas = viewerRef.current.get('canvas');
        canvas.zoom('fit-viewport');
      } catch (err) {
        console.error('Error rendering BPMN:', err);
      }
    };

    loadDiagram();
  }, [xml]);

  const handleZoomIn = () => viewerRef.current?.get('zoomScroll').stepZoom(1);
  const handleZoomOut = () => viewerRef.current?.get('zoomScroll').stepZoom(-1);
  const handleResetZoom = () => viewerRef.current?.get('canvas').zoom('fit-viewport');

  const handleDownloadSvg = async () => {
    if (!viewerRef.current) return;
    try {
      const { svg } = await viewerRef.current.saveSVG();
      const blob = new Blob([svg], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'process-diagram.svg';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error exporting SVG:', err);
    }
  };

  return (
    <div className="relative w-full h-[600px] border border-theme-border rounded-xl bg-white overflow-hidden shadow-sm group">
      <div ref={containerRef} className="w-full h-full" />
      
      {/* Controls */}
      <div className="absolute bottom-4 right-4 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button 
          onClick={handleZoomIn}
          className="p-2 bg-theme-surface border border-theme-border rounded-lg hover:bg-theme-surface-hover text-theme-text shadow-lg transition-all"
          title="Yakınlaştır"
        >
          <Maximize2 size={16} />
        </button>
        <button 
          onClick={handleZoomOut}
          className="p-2 bg-theme-surface border border-theme-border rounded-lg hover:bg-theme-surface-hover text-theme-text shadow-lg transition-all"
          title="Uzaklaştır"
        >
          <Minimize2 size={16} />
        </button>
        <button 
          onClick={handleResetZoom}
          className="px-3 py-2 bg-theme-surface border border-theme-border rounded-lg hover:bg-theme-surface-hover text-theme-text text-xs font-bold uppercase tracking-widest shadow-lg transition-all"
        >
          Sığdır
        </button>
        <button 
          onClick={handleDownloadSvg}
          className="p-2 bg-theme-primary text-theme-primary-fg rounded-lg hover:bg-theme-primary/90 shadow-lg transition-all"
          title="SVG Olarak İndir"
        >
          <Download size={16} />
        </button>
      </div>

      {/* BPMN Watermark Overlay (Optional: bpmn-js has its own, but we can style it) */}
      <div className="absolute top-4 left-4 pointer-events-none">
        <div className="text-[10px] font-bold uppercase tracking-widest text-theme-text-muted/30">
          BPMN 2.0 Visualizer
        </div>
      </div>
    </div>
  );
}
