import { messages } from "@/i18n";
import { agentsMessages } from "./messages";

/** Group roles and their colors (spec theme §4.1, §11.2). */
export type RoleId = "frontend" | "backend" | "testers" | "reviewers" | "design" | "docs" | "security" | "general";

export interface Role {
  label: string;
  color: string;
}

export const ROLES: Record<RoleId, Role> = {
  frontend: {
    get label() {
      return messages(agentsMessages).roles.frontend;
    },
    color: "#C18E57",
  },
  backend: {
    get label() {
      return messages(agentsMessages).roles.backend;
    },
    color: "#AA88D2",
  },
  testers: {
    get label() {
      return messages(agentsMessages).roles.testers;
    },
    color: "#86A174",
  },
  reviewers: {
    get label() {
      return messages(agentsMessages).roles.reviewers;
    },
    color: "#90B1D4",
  },
  design: {
    get label() {
      return messages(agentsMessages).roles.design;
    },
    color: "#CE7B8F",
  },
  docs: {
    get label() {
      return messages(agentsMessages).roles.docs;
    },
    color: "#77B7C0",
  },
  security: {
    get label() {
      return messages(agentsMessages).roles.security;
    },
    color: "#D88479",
  },
  general: {
    get label() {
      return messages(agentsMessages).roles.general;
    },
    color: "#8A8A80",
  },
};

export const ROLE_ORDER = Object.keys(ROLES) as RoleId[];

export function isRoleId(value: unknown): value is RoleId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ROLES, value);
}
