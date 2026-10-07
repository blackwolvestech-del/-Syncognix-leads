"use client"

import {
  Archive,
  ArchiveRestore,
  CalendarClock,
  CalendarX,
  ChevronDown,
  Download,
  Flag,
  ListPlus,
  MoreHorizontal,
  Plus,
  ScanSearch,
  Tag,
  Trash2,
  UserRoundCheck,
  UserRoundX,
  Workflow,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  PIPELINE_STAGES,
  PRIORITIES,
  PRIORITY_LABELS,
  STAGE_LABELS,
  type PipelineStage,
  type Priority,
} from "@/lib/pipeline/config"
import type { LeadList, LeadTag } from "@/types/pipeline"
import { StageDot } from "./fields"

const EMPTY = "px-2 py-1.5 text-xs text-muted-foreground"

function MenuButton({ icon, label, disabled, children }: { icon: React.ReactNode; label: string; disabled: boolean; children: React.ReactNode }) {
  return (
    // Non-modal so a dialog opened from an item gets focus cleanly.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="bg-background" disabled={disabled}>
          {icon} {label} <ChevronDown className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 w-56 overflow-y-auto">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Actions for the selected leads. Destructive ones only ask here; the table confirms them. */
export function BulkActions({
  count,
  disabled,
  lists,
  tags,
  /** Tags carried by at least one selected lead (the only ones worth offering to remove). */
  selectedTagIds,
  unanalyzedCount,
  showingArchived,
  onClear,
  onStage,
  onPriority,
  onAddToList,
  onNewList,
  onAddTag,
  onNewTag,
  onRemoveTag,
  onAssign,
  onFollowUp,
  onClearFollowUp,
  onAnalyze,
  onExport,
  onArchive,
  onRestore,
  onDelete,
}: {
  count: number
  disabled: boolean
  lists: LeadList[]
  tags: LeadTag[]
  selectedTagIds: ReadonlySet<string>
  unanalyzedCount: number
  showingArchived: boolean
  onClear: () => void
  onStage: (stage: PipelineStage) => void
  onPriority: (priority: Priority) => void
  onAddToList: (list: LeadList) => void
  onNewList: () => void
  onAddTag: (tag: LeadTag) => void
  onNewTag: () => void
  onRemoveTag: (tag: LeadTag) => void
  onAssign: (toMe: boolean) => void
  onFollowUp: () => void
  onClearFollowUp: () => void
  onAnalyze: () => void
  onExport: () => void
  onArchive: () => void
  onRestore: () => void
  onDelete: () => void
}) {
  const removable = tags.filter((tag) => selectedTagIds.has(tag.id))
  return (
    <div className="flex w-full flex-wrap items-center gap-2" role="region" aria-label="Actions for selected leads">
      <span className="font-medium text-foreground tabular-nums" aria-live="polite">
        Selected: {count} {count === 1 ? "lead" : "leads"}
      </span>
      <Button variant="ghost" size="sm" onClick={onClear} disabled={disabled}>
        <X /> Deselect
      </Button>

      <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
        <MenuButton icon={<Workflow />} label="Stage" disabled={disabled}>
          <DropdownMenuLabel>Move to stage</DropdownMenuLabel>
          {PIPELINE_STAGES.map((stage) => (
            <DropdownMenuItem key={stage} onSelect={() => onStage(stage)}>
              <StageDot stage={stage} /> {STAGE_LABELS[stage]}
            </DropdownMenuItem>
          ))}
        </MenuButton>

        <MenuButton icon={<Flag />} label="Priority" disabled={disabled}>
          <DropdownMenuLabel>Set priority</DropdownMenuLabel>
          {PRIORITIES.map((priority) => (
            <DropdownMenuItem key={priority} onSelect={() => onPriority(priority)}>
              {PRIORITY_LABELS[priority]}
            </DropdownMenuItem>
          ))}
        </MenuButton>

        <MenuButton icon={<ListPlus />} label="Add to List" disabled={disabled}>
          {lists.length === 0 && <p className={EMPTY}>No lists yet.</p>}
          {lists.map((list) => (
            <DropdownMenuItem key={list.id} onSelect={() => onAddToList(list)}>
              <span className="truncate">{list.name}</span>
              <span className="ml-auto text-xs text-muted-foreground tabular-nums">{list.count}</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onNewList}>
            <Plus /> New list…
          </DropdownMenuItem>
        </MenuButton>

        <MenuButton icon={<Tag />} label="Tags" disabled={disabled}>
          <DropdownMenuLabel>Add tag</DropdownMenuLabel>
          {tags.length === 0 && <p className={EMPTY}>No tags yet.</p>}
          {tags.map((tag) => (
            <DropdownMenuItem key={tag.id} onSelect={() => onAddTag(tag)}>
              <span className="truncate">{tag.name}</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem onSelect={onNewTag}>
            <Plus /> New tag…
          </DropdownMenuItem>
          {removable.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Remove tag</DropdownMenuLabel>
              {removable.map((tag) => (
                <DropdownMenuItem key={tag.id} onSelect={() => onRemoveTag(tag)}>
                  <X /> <span className="truncate">{tag.name}</span>
                </DropdownMenuItem>
              ))}
            </>
          )}
        </MenuButton>

        <MenuButton icon={<MoreHorizontal />} label="More" disabled={disabled}>
          <DropdownMenuItem onSelect={onFollowUp}>
            <CalendarClock /> Set follow-up…
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onClearFollowUp}>
            <CalendarX /> Clear follow-up
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => onAssign(true)}>
            <UserRoundCheck /> Assign to me
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onAssign(false)}>
            <UserRoundX /> Unassign
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {unanalyzedCount > 0 && (
            <DropdownMenuItem onSelect={onAnalyze}>
              <ScanSearch /> Analyze ({unanalyzedCount} not analyzed)
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={onExport}>
            <Download /> Export selected (CSV)
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {showingArchived ? (
            <DropdownMenuItem onSelect={onRestore}>
              <ArchiveRestore /> Restore
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={onArchive}>
              <Archive /> Archive…
            </DropdownMenuItem>
          )}
          <DropdownMenuItem variant="destructive" onSelect={onDelete}>
            <Trash2 /> Delete permanently…
          </DropdownMenuItem>
        </MenuButton>
      </div>
    </div>
  )
}
