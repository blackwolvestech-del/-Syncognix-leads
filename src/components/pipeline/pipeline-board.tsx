"use client"

import { useState } from "react"
import Link from "next/link"
import { ScorePill } from "@/components/analysis/score-indicators"
import { cityState } from "@/components/leads/business-cells"
import {
  PIPELINE_CONFIG,
  PIPELINE_STAGES,
  STAGE_LABELS,
  isOutreachReady,
  type PipelineStage,
} from "@/lib/pipeline/config"
import { cn } from "@/lib/utils"
import type { LeadOverviewRow } from "@/types"
import type { LeadTag } from "@/types/pipeline"
import { FollowUpBadge, OutreachReadyBadge, PriorityBadge, StageDot, StageSelect, TagChips } from "./fields"
import { useLeadActions } from "./use-lead-actions"

const DRAG_TYPE = "application/x-syncognix-lead"

/**
 * Kanban view of the pipeline. Cards can be dragged between stages with a
 * mouse; the "Move to" select on every card does the same for keyboard and
 * touch. Either way the card moves at once and snaps back if saving fails.
 */
export function PipelineBoard({
  leads: serverLeads,
  counts,
  tags,
  currentUserId,
  stageHrefs,
}: {
  leads: LeadOverviewRow[]
  /** Leads matching the current filters in each stage; may exceed the cards loaded. */
  counts: Record<PipelineStage, number>
  tags: LeadTag[]
  currentUserId: string
  /** Link to the table view of each stage, for stages with more leads than cards. */
  stageHrefs: Record<PipelineStage, string>
}) {
  const { rows: leads, update } = useLeadActions(serverLeads, currentUserId)
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<PipelineStage | null>(null)

  const move = (id: string, stage: PipelineStage) => {
    const lead = leads.find((entry) => entry.id === id)
    if (lead && lead.pipeline_stage !== stage) void update([id], { stage })
  }

  return (
    // Horizontal scrolling stays inside the board, never the page.
    <div className="overflow-x-auto overscroll-x-contain p-4 sm:p-5" role="list" aria-label="Pipeline stages">
      <div className="flex w-max gap-3">
        {PIPELINE_STAGES.map((stage) => {
          const cards = leads.filter((lead) => lead.pipeline_stage === stage)
          // Server count, adjusted by cards moved in or out but not yet saved.
          const loaded = serverLeads.filter((lead) => lead.pipeline_stage === stage).length
          const total = Math.max(cards.length, counts[stage] + cards.length - loaded)
          return (
            <section
              key={stage}
              role="listitem"
              aria-label={`${STAGE_LABELS[stage]}, ${total} ${total === 1 ? "lead" : "leads"}`}
              onDragOver={(event) => {
                if (!event.dataTransfer.types.includes(DRAG_TYPE)) return
                event.preventDefault()
                event.dataTransfer.dropEffect = "move"
                if (over !== stage) setOver(stage)
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(null)
              }}
              onDrop={(event) => {
                event.preventDefault()
                const id = event.dataTransfer.getData(DRAG_TYPE)
                setOver(null)
                setDragging(null)
                if (id) move(id, stage)
              }}
              className={cn(
                "flex w-[17rem] shrink-0 flex-col rounded-lg border bg-muted/30 transition-colors",
                over === stage && "border-primary/50 bg-primary/5"
              )}
            >
              <header className="flex items-center gap-2 border-b px-3 py-2.5">
                <StageDot stage={stage} />
                <h3 className="text-sm font-medium">{STAGE_LABELS[stage]}</h3>
                <span className="ml-auto rounded-full bg-background px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
                  {total}
                </span>
              </header>

              <ul className="flex max-h-[34rem] min-h-24 flex-col gap-2 overflow-y-auto p-2">
                {cards.length === 0 && (
                  <li className="px-2 py-6 text-center text-xs text-muted-foreground">No leads in this stage.</li>
                )}
                {cards.map((lead) => (
                  <li
                    key={lead.id}
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData(DRAG_TYPE, lead.id)
                      event.dataTransfer.effectAllowed = "move"
                      setDragging(lead.id)
                    }}
                    onDragEnd={() => {
                      setDragging(null)
                      setOver(null)
                    }}
                    className={cn(
                      "cursor-grab space-y-2 rounded-md border bg-card p-3 shadow-xs transition-opacity active:cursor-grabbing",
                      dragging === lead.id && "opacity-50"
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <Link
                          href={`/leads/${lead.id}`}
                          draggable={false}
                          className="line-clamp-2 rounded-sm text-sm leading-snug font-medium outline-none hover:underline hover:underline-offset-4 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                        >
                          {lead.name}
                        </Link>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {cityState(lead.city, lead.state) ?? "Location not available"}
                        </p>
                      </div>
                      <ScorePill score={lead.qualified_lead_score} label="Qualified lead score" className="shrink-0" />
                    </div>

                    {(lead.contact_full_name || lead.contact_title) && (
                      <p className="truncate text-xs">
                        <span className="font-medium">{lead.contact_full_name ?? "Decision maker"}</span>
                        {lead.contact_title && <span className="text-muted-foreground"> · {lead.contact_title}</span>}
                      </p>
                    )}

                    <div className="flex flex-wrap items-center gap-1">
                      {lead.priority !== "medium" && <PriorityBadge priority={lead.priority} />}
                      <FollowUpBadge followUpAt={lead.follow_up_at} note={lead.follow_up_note} />
                      {isOutreachReady(lead) && <OutreachReadyBadge />}
                    </div>
                    <TagChips tagIds={lead.tag_ids} tags={tags} max={2} />

                    <StageSelect
                      value={lead.pipeline_stage}
                      onChange={(next) => move(lead.id, next)}
                      label={`Move ${lead.name} to another stage`}
                      className="h-7 text-xs"
                    />
                  </li>
                ))}
              </ul>

              {total > cards.length && (
                <footer className="border-t px-3 py-2 text-xs text-muted-foreground">
                  Showing the top {Math.min(cards.length, PIPELINE_CONFIG.boardColumnLimit)} of {total}.{" "}
                  <Link href={stageHrefs[stage]} className="text-primary underline-offset-4 hover:underline">
                    View all
                  </Link>
                </footer>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}
