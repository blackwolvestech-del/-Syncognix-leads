"use client"

import { ListPlus, Plus, Tag } from "lucide-react"
import {
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu"
import type { LeadList, LeadTag } from "@/types/pipeline"

const EMPTY = "px-2 py-1.5 text-xs text-muted-foreground"

/**
 * "Tags" and "Lists" sub-menus for one lead: tick to add, untick to remove.
 * The menu stays open while ticking so several can be changed at once.
 */
export function MembershipMenus({
  tags,
  lists,
  tagIds,
  listIds,
  onToggleTag,
  onToggleList,
  onNewTag,
  onNewList,
}: {
  tags: LeadTag[]
  lists: LeadList[]
  tagIds: string[]
  listIds: string[]
  onToggleTag: (tag: LeadTag, on: boolean) => void
  onToggleList: (list: LeadList, on: boolean) => void
  onNewTag: () => void
  onNewList: () => void
}) {
  return (
    <>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <Tag /> Tags
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="max-h-72 w-52 overflow-y-auto">
          {tags.length === 0 && <p className={EMPTY}>No tags yet.</p>}
          {tags.map((tag) => (
            <DropdownMenuCheckboxItem
              key={tag.id}
              checked={tagIds.includes(tag.id)}
              onCheckedChange={(checked) => onToggleTag(tag, checked === true)}
              onSelect={(event) => event.preventDefault()}
            >
              <span className="truncate">{tag.name}</span>
            </DropdownMenuCheckboxItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onNewTag}>
            <Plus /> New tag…
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <ListPlus /> Lists
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="max-h-72 w-56 overflow-y-auto">
          {lists.length === 0 && <p className={EMPTY}>No lists yet.</p>}
          {lists.map((list) => (
            <DropdownMenuCheckboxItem
              key={list.id}
              checked={listIds.includes(list.id)}
              onCheckedChange={(checked) => onToggleList(list, checked === true)}
              onSelect={(event) => event.preventDefault()}
            >
              <span className="truncate">{list.name}</span>
            </DropdownMenuCheckboxItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onNewList}>
            <Plus /> New list…
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </>
  )
}
