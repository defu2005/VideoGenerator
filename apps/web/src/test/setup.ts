import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

if (typeof HTMLDialogElement.prototype.showModal !== "function") {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
}

if (typeof HTMLDialogElement.prototype.close !== "function") {
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
