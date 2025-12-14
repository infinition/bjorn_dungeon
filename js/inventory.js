export class Inventory {
    constructor() {
        this.items = [];
        this.capacity = 20;
        this.equipment = {
            mainHand: null,
            offHand: null,
            armor: null
        };
    }

    addItem(item) {
        if (this.items.length < this.capacity) {
            this.items.push(item);
            return true;
        }
        return false;
    }

    removeItem(index) {
        if (index >= 0 && index < this.items.length) {
            return this.items.splice(index, 1)[0];
        }
        return null;
    }

    equipItem(index, slot) {
        const item = this.items[index];
        if (!item) return;

        // Swap if slot occupied
        if (this.equipment[slot]) {
            this.items[index] = this.equipment[slot];
            this.equipment[slot] = item;
        } else {
            this.equipment[slot] = item;
            this.removeItem(index);
        }
    }
}

export const playerInventory = new Inventory();
