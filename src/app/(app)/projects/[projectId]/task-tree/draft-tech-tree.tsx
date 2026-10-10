"use client";

import { useState } from "react";
import { DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors, useDraggable, useDroppable, pointerWithin, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import { taskLevels, type DraftTask, type StagePlan } from "@/lib/draft-planning";

type Point = { x: number; y: number };
type TreeProps = {
  draftId: string; tasks: DraftTask[]; plan: StagePlan; selectedKey: string | null; analysed: boolean;
  members: { id: string; name: string }[]; disabled: boolean; readOnly?: boolean;
  onSelect: (key: string) => void; onAdd: (key: string) => void; onDelete: (key: string) => void;
  onConnect: (key: string, target: string | null, parallel: boolean) => void;
};

function DropTarget({ id, children, disabled }: { id: string; children: React.ReactNode; disabled: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled });
  return <span ref={setNodeRef} className={`ac-tech-drop ${isOver ? "is-over" : ""}`}>{children}</span>;
}

function TaskNode({ task, point, group, selected, owner, zoom, ...props }: {
  task: DraftTask; point: Point; group: boolean; selected: boolean; owner: string; zoom: number;
  dragging: boolean; disabled: boolean; readOnly?: boolean; onSelect: () => void; onAdd: () => void; onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, isDragging } = useDraggable({ id: task.key, disabled: props.disabled || props.readOnly || group });
  return <article ref={setNodeRef} className={`ac-tech-node ${selected ? "is-selected" : ""} ${group ? "is-group" : ""} ${isDragging ? "is-dragging" : ""}`}
    style={{ left: point.x, top: point.y, transform: transform ? `translate3d(${transform.x / zoom}px,${transform.y / zoom}px,0)` : undefined }}>
    {!props.readOnly && <button type="button" className="ac-tech-minus" aria-label={`删除任务：${task.title || "未命名"}`} disabled={props.disabled} onClick={props.onDelete}>−</button>}
    <div className="ac-tech-node-head"><span>{group ? "任务分组" : "执行任务"}</span>
      {!group && !props.readOnly && <button ref={setActivatorNodeRef} type="button" {...attributes} {...listeners} className="ac-tech-handle" disabled={props.disabled} aria-label={`拖动任务：${task.title || "未命名"}`}>⠿</button>}
    </div>
    <button type="button" className="ac-tech-node-title" disabled={props.disabled && !props.readOnly} aria-label={`${props.readOnly ? "查看" : "编辑"}任务：${task.title || "未命名"}`} onClick={props.onSelect}>{task.title || "给新任务起个名字"}</button>
    <div className="ac-tech-node-foot"><span>{owner}</span><span>{task.doneCriteria.filter(text => text.trim()).length} 项验收标准</span></div>
    {!props.readOnly && <button type="button" className="ac-tech-plus" disabled={props.disabled} aria-label={`在任务后新增：${task.title || "未命名"}`} onClick={props.onAdd}>＋</button>}
    {props.dragging && !isDragging && !group && <div className="ac-tech-targets">
      <DropTarget id={`after:${task.key}`} disabled={props.disabled}>接在此任务后</DropTarget>
      <DropTarget id={`parallel:${task.key}`} disabled={props.disabled}>与此任务并行</DropTarget>
    </div>}
  </article>;
}

export function DraftTechTree(props: TreeProps) {
  const [dragging, setDragging] = useState(false);
  const [zoom, setZoom] = useState(1);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));
  const groups = new Set(props.tasks.flatMap(task => task.parentKey ? [task.parentKey] : []));
  const levels = taskLevels(props.plan);
  const rows = new Map<number, number>();
  const positions = new Map<string, Point>();
  const orderedTasks = props.plan.links.map(link => props.tasks.find(task => task.key === link.key)!).filter(Boolean);
  for (const task of orderedTasks) {
    const column = groups.has(task.key) ? 0 : (levels.get(task.key) ?? 0) + (groups.size ? 1 : 0);
    const row = rows.get(column) ?? 0;
    positions.set(task.key, { x: 46 + column * 330, y: 70 + row * 172 });
    rows.set(column, row + 1);
  }
  const width = Math.max(670, 46 + (Math.max(0, ...rows.keys()) + 1) * 330);
  const height = Math.max(340, 96 + Math.max(1, ...rows.values()) * 172);
  function end(event: DragEndEvent) {
    setDragging(false);
    if (!event.over) return;
    const id = String(event.over.id);
    if (id === "start") props.onConnect(String(event.active.id), null, false);
    else {
      const separator = id.indexOf(":");
      props.onConnect(String(event.active.id), id.slice(separator + 1), id.startsWith("parallel:"));
    }
  }
  return <div className="ac-tech-tree">
    <div className="ac-tech-toolbar"><p>{props.analysed ? "从左向右推进，同一列可并行。" : "关系尚未确认，当前仅展示任务。"}{props.readOnly ? "点击任务查看详情。" : "点击任务编辑；拖动 ⠿ 调整分支。"}</p>
      <div className="flex items-center gap-2"><button type="button" className="ac-btn-ghost" aria-label="缩小任务树" onClick={() => setZoom(value => Math.max(.6, value - .1))}>−</button><span className="text-xs tabular-nums">{Math.round(zoom * 100)}%</span><button type="button" className="ac-btn-ghost" aria-label="放大任务树" onClick={() => setZoom(value => Math.min(1.3, value + .1))}>＋</button></div>
    </div>
    <DndContext id={`draft-${props.draftId}-${props.plan.stageIndex}`} sensors={sensors}
      collisionDetection={args => args.pointerCoordinates ? pointerWithin(args) : closestCenter(args)}
      onDragStart={() => setDragging(true)} onDragCancel={() => setDragging(false)} onDragEnd={end}>
      {dragging && <div className="ac-tech-start-target"><DropTarget id="start" disabled={props.disabled}>移到起点，不依赖其他任务</DropTarget></div>}
      <div className="ac-tech-viewport" tabIndex={0} aria-label="可滚动的任务编排树">
        <div style={{ width: width * zoom, height: height * zoom }}>
          <div className="ac-tech-canvas" style={{ width, height, transform: `scale(${zoom})` }}>
            {[...rows.keys()].map(column => <span key={column} className="ac-tech-column" style={{ left: 46 + column * 330 }}>{groups.size && column === 0 ? "分组" : props.analysed ? `步骤 ${column + (groups.size ? 0 : 1)}` : "等待关系分析"}</span>)}
            <svg width={width} height={height} className="ac-tech-lines" aria-hidden="true">
              {props.plan.links.flatMap(link => link.afterKeys.map(before => {
                const start = positions.get(before), finish = positions.get(link.key);
                if (!start || !finish) return null;
                const mid = (start.x + 252 + finish.x) / 2;
                return <path key={`${before}-${link.key}`} d={`M ${start.x + 252} ${start.y + 58} H ${mid} V ${finish.y + 58} H ${finish.x}`} />;
              }))}
              {props.tasks.filter(task => task.parentKey).map(task => {
                const start = positions.get(task.parentKey!), finish = positions.get(task.key);
                if (!start || !finish) return null;
                return <path key={`group-${task.key}`} className="is-group" d={`M ${start.x + 252} ${start.y + 58} H ${start.x + 286} V ${finish.y + 58} H ${finish.x}`} />;
              })}
            </svg>
            {orderedTasks.map(task => <TaskNode key={task.key} task={task} point={positions.get(task.key)!}
              group={groups.has(task.key)} selected={props.selectedKey === task.key} owner={props.members.find(member => member.id === task.assigneeId)?.name ?? "待分配"}
              readOnly={props.readOnly} zoom={zoom} dragging={dragging} disabled={props.disabled} onSelect={() => props.onSelect(task.key)} onAdd={() => props.onAdd(task.key)} onDelete={() => props.onDelete(task.key)} />)}
          </div>
        </div>
      </div>
    </DndContext>
  </div>;
}
