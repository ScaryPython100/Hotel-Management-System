import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractBaseItemName,
  extractItemQuantity,
  normalizeReturnableName,
  isTargetAutoUnavailableItem,
  isReturnableItem
} from "../types";

describe("src/types.ts utility functions", () => {
  describe("extractBaseItemName", () => {
    it("returns empty string for empty or falsy input", () => {
      assert.equal(extractBaseItemName(""), "");
    });

    it("returns trimmed item name when no quantity suffix is present", () => {
      assert.equal(extractBaseItemName("  Iron Box  "), "Iron Box");
      assert.equal(extractBaseItemName("Glasses (Set of 2)"), "Glasses (Set of 2)");
      assert.equal(extractBaseItemName("Leg Massager (Paid)"), "Leg Massager (Paid)");
    });

    it("strips parenthesized quantity patterns like (qty: 2), (2x), and (3)", () => {
      assert.equal(extractBaseItemName("Kettle (qty: 2)"), "Kettle");
      assert.equal(extractBaseItemName("Hair Dryer (2x)"), "Hair Dryer");
      assert.equal(extractBaseItemName("Iron Box (3)"), "Iron Box");
    });

    it("strips trailing multiplier suffix like x2 or x 4", () => {
      assert.equal(extractBaseItemName("Kettle x2"), "Kettle");
      assert.equal(extractBaseItemName("Laptop Table x 4"), "Laptop Table");
    });
  });

  describe("extractItemQuantity", () => {
    it("returns 1 for empty or plain item names", () => {
      assert.equal(extractItemQuantity(""), 1);
      assert.equal(extractItemQuantity("Iron Box"), 1);
      assert.equal(extractItemQuantity("Glasses (Set of 2)"), 1);
    });

    it("extracts quantity from parenthesized formats", () => {
      assert.equal(extractItemQuantity("Kettle (qty: 3)"), 3);
      assert.equal(extractItemQuantity("Hair Dryer (4x)"), 4);
      assert.equal(extractItemQuantity("Laptop Table (2)"), 2);
    });

    it("extracts quantity from trailing xN formats", () => {
      assert.equal(extractItemQuantity("Kettle x5"), 5);
      assert.equal(extractItemQuantity("Iron Box x 2"), 2);
    });

    it("clamps zero or invalid quantities to at least 1", () => {
      assert.equal(extractItemQuantity("Kettle (qty: 0)"), 1);
    });
  });

  describe("normalizeReturnableName", () => {
    it("normalizes returnable items and their aliases", () => {
      assert.equal(normalizeReturnableName("Teakettle"), "Kettle");
      assert.equal(normalizeReturnableName("kettle (qty: 2)"), "Kettle");
      assert.equal(normalizeReturnableName("Steam Iron"), "Iron Box");
      assert.equal(normalizeReturnableName("Blow Dryer"), "Hair Dryer");
      assert.equal(normalizeReturnableName("Laptop Desk"), "Laptop Table");
      assert.equal(normalizeReturnableName("Set of Glasses (qty: 2)"), "Set of Glasses");
      assert.equal(normalizeReturnableName("Maggi (₹20 Per Pack)"), "Maggi");
    });

    it("returns cleaned base name for unrecognized items", () => {
      assert.equal(normalizeReturnableName("Extra Pillow (qty: 2)"), "Extra Pillow");
    });
  });

  describe("isTargetAutoUnavailableItem", () => {
    it("returns false for empty string or non-target service items", () => {
      assert.equal(isTargetAutoUnavailableItem(""), false);
      assert.equal(isTargetAutoUnavailableItem("Water Bottle (Paid)"), false);
      assert.equal(isTargetAutoUnavailableItem("Stay Extension"), false);
    });

    it("returns true for canonical target items and their aliases", () => {
      assert.equal(isTargetAutoUnavailableItem("Iron Box"), true);
      assert.equal(isTargetAutoUnavailableItem("Teakettle"), true);
      assert.equal(isTargetAutoUnavailableItem("Set of Glasses"), true);
      assert.equal(isTargetAutoUnavailableItem("Maggi"), true);
    });
  });

  describe("isReturnableItem", () => {
    it("returns false for empty string, consumables, and services", () => {
      assert.equal(isReturnableItem(""), false);
      assert.equal(isReturnableItem("Water Bottle (Paid)"), false);
      assert.equal(isReturnableItem("Shower Gel Refill"), false);
      assert.equal(isReturnableItem("Shampoo Refill"), false);
      assert.equal(isReturnableItem("Hand wash Refill"), false);
      assert.equal(isReturnableItem("Stay Extension"), false);
      assert.equal(isReturnableItem("Housekeeping Service (Only Between 9 A.M. and 5 P.M.)"), false);
      assert.equal(isReturnableItem("Coffee & Tea Bag"), false);
    });

    it("returns true for durable borrowed appliances and inventory items", () => {
      assert.equal(isReturnableItem("Iron Box"), true);
      assert.equal(isReturnableItem("Kettle (qty: 2)"), true);
      assert.equal(isReturnableItem("Teakettle"), true);
      assert.equal(isReturnableItem("Hair Dryer"), true);
      assert.equal(isReturnableItem("Laptop Table"), true);
      assert.equal(isReturnableItem("Set of Glasses"), true);
      assert.equal(isReturnableItem("Hot Pack"), true);
    });

    it("returns false for unknown custom items not matching returnable keywords", () => {
      assert.equal(isReturnableItem("Unknown Custom Amenity"), false);
    });
  });
});
