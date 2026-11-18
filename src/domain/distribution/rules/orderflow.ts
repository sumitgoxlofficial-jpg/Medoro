// Order lifecycle. Every status change goes through `canMove`, so the order screen, the warehouse app and the
// portal can never skip a step (e.g. invoice an order nobody approved).

export const ORDER_STATUS = {
  pending: "Awaiting approval",
  approved: "Approved",
  picking: "Picking",
  packed: "Packed",
  invoiced: "Invoiced",
  dispatched: "Out for delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
  rejected: "Rejected",
} as const;
export type OrderStatus = keyof typeof ORDER_STATUS;

const NEXT: Record<OrderStatus, OrderStatus[]> = {
  pending: ["approved", "rejected", "cancelled"],
  approved: ["picking", "cancelled"],
  picking: ["packed", "cancelled"],
  packed: ["invoiced", "cancelled"],
  invoiced: ["dispatched", "delivered"],
  dispatched: ["delivered", "invoiced"], // failed delivery comes back to invoiced
  delivered: [],
  cancelled: [],
  rejected: [],
};

export const canMove = (from: string, to: OrderStatus) => (NEXT[from as OrderStatus] ?? []).includes(to);

export function assertMove(from: string, to: OrderStatus) {
  if (!canMove(from, to)) throw new Error(`An order that is ${ORDER_STATUS[from as OrderStatus]?.toLowerCase() ?? from} can’t be moved to ${ORDER_STATUS[to].toLowerCase()}.`);
}

export const OPEN_STATUSES: OrderStatus[] = ["pending", "approved", "picking", "packed"];
