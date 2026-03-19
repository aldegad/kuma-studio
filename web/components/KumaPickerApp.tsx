"use client";

import KumaPickerBoard from "./KumaPickerBoard";
import KumaPickerSidebar from "./KumaPickerSidebar";
import { useKumaPickerWorkspace } from "../lib/use-kuma-picker-workspace";
import type { KumaPickerComponentItem } from "../lib/types";

interface KumaPickerAppProps {
  items: KumaPickerComponentItem[];
  itemsById: Map<string, KumaPickerComponentItem>;
}

export default function KumaPickerApp({ items, itemsById }: KumaPickerAppProps) {
  const workspace = useKumaPickerWorkspace({
    items,
    itemsById,
  });

  return (
    <main className="h-screen overflow-hidden bg-[#ececec] p-4 sm:p-5">
      <div className="mx-auto flex h-full max-w-[1840px] flex-col rounded-[2.5rem] border border-white/75 bg-[#f7f7f7] p-4 shadow-[0_30px_90px_rgba(17,24,39,0.08)] sm:p-5">
        <div
          className={
            workspace.isReadOnly ? "min-h-0 flex-1" : "grid min-h-0 flex-1 gap-4 lg:grid-cols-[320px_minmax(0,1fr)]"
          }
        >
          {workspace.isReadOnly ? null : (
            <KumaPickerSidebar
              query={workspace.query}
              onQueryChange={workspace.setQuery}
              items={workspace.filteredItems}
              totalStudies={workspace.visibleStudies.length}
              onAddItem={workspace.actions.addItemToCanvas}
            />
          )}

          <KumaPickerBoard
            readOnly={workspace.isReadOnly}
            studies={workspace.visibleStudies}
            selectedStudyId={workspace.selectedStudyId}
            zoom={workspace.zoom}
            copyState={workspace.copyState}
            syncState={workspace.syncState}
            lastSavedAt={workspace.lastSavedAt}
            getItem={(itemId) => itemsById.get(itemId)}
            onZoomChange={workspace.setZoom}
            onToolbarHeightChange={workspace.setToolbarSafeTop}
            onReloadScene={() => {
              void workspace.reloadScene();
            }}
            onSelectStudy={workspace.selectStudy}
            onClearSelection={() => workspace.selectStudy(null)}
            onDropItem={workspace.actions.addItemToCanvas}
            onBringToFront={workspace.actions.bringStudyToFront}
            onUpdateStudyPosition={workspace.actions.updateStudyPosition}
            onCommitStudyPosition={workspace.actions.commitStudyPlacement}
            onViewportChange={workspace.actions.updateStudyViewport}
            onRemoveStudy={workspace.actions.removeStudy}
            onClearBoard={workspace.actions.clearBoard}
            onAutoArrange={workspace.actions.arrangeBoard}
            onExportLayout={workspace.actions.exportLayout}
          />
        </div>
      </div>
    </main>
  );
}
