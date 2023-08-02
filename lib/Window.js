const assert = require('assert')
const EventEmitter = require('events').EventEmitter

module.exports = (Item, registry) => {
  return class Window extends EventEmitter {
    constructor (id, type, title, slotCount,
      inventorySlotsRange = { start: 27, end: 62 },
      craftingResultSlot = -1,
      requiresConfirmation = true) {
      super()
      this.id = id
      this.type = type
      this.title = title
      this.slots = new Array(slotCount).fill(null)
      this.inventoryStart = inventorySlotsRange.start
      this.inventoryEnd = inventorySlotsRange.end + 1
      this.hotbarStart = this.inventoryEnd - 9
      this.craftingResultSlot = craftingResultSlot
      this.requiresConfirmation = requiresConfirmation
      // in vanilla client, this is the item you are holding with the
      // mouse cursor
      this.selectedItem = null
    }

    acceptClick (click, bot) {
      const gamemode = bot.game.gameMode

      const { mode, slot, mouseButton } = click
      assert.ok(
        (mode >= 0 && mode <= 6) &&
        (mouseButton >= 0 && mouseButton <= 8) &&
        ((slot >= 0 && slot < this.inventoryEnd) || slot === -999 ||
         (this.type === 'minecraft:inventory' && slot === 45)),
        'invalid operation')

      // can not use structuredClone because of
      // potentially incompatible node versions
      const oldSlots = JSON.parse(JSON.stringify(this.slots))

      switch (click.mode) {
        case 0:
          assert.ok(mouseButton <= 1, 'invalid operation')
          this.mouseClick(click)
          break

        case 1:
          assert.ok(mouseButton <= 1, 'invalid operation')
          this.shiftClick(click)
          break

        case 2:
          assert.ok(mouseButton <= 8, 'invalid operation')
          this.numberClick(click)
          break

        case 3:
          assert.ok(mouseButton === 2, 'invalid operation')
          this.middleClick(click, gamemode)
          break

        case 4:
          assert.ok(mouseButton <= 1, 'invalid operation')
          this.dropClick(click)
          break

        case 5:
          assert.ok([1, 5, 9, 2, 6, 10].includes(mouseButton), 'invalid operation')
          this.dragClick(click, gamemode)
          break

        case 6:
          assert.ok(click.slot >= 0, 'negative slot number at double click')
          assert.ok(click.mouseButton === 0 || click.mouseButton === 1, 'non existent mouse button')
          this.doubleClick(click, bot)
          break
      }

      // this is required to satisfy mc versions >= 1.17
      return this.getChangedSlotsAsNotch(oldSlots, this.slots)
    }

    mouseClick (click) {
      if (click.slot === -999) {
        this.dropSelectedItem(click.mouseButton === 0)
      } else {
        let { item } = click
        if (click.mouseButton === 0) { // left click
          if (item && this.selectedItem) {
            if (Item.equal(item, this.selectedItem, false)) {
              if (click.slot === this.craftingResultSlot) {
                if (item.count + this.selectedItem.count > item.stackSize) {
                  this.selectedItem.count += item.count
                  this.updateSlot(item.slot, null)
                }
              } else {
                this.fillSlotWithSelectedItem(item, true)
              }
            } else {
              this.swapSelectedItem(click.slot, item)
            }
          } else if (this.selectedItem || item) {
            this.swapSelectedItem(click.slot, item)
          }
        } else if (click.mouseButton === 1) { // right click
          if (this.selectedItem) {
            if (item) {
              if (Item.equal(item, this.selectedItem, false)) {
                this.fillSlotWithSelectedItem(item, false)
              } else {
                this.swapSelectedItem(click.slot, item)
              }
            } else {
              item = new Item(this.selectedItem.type, 0, this.selectedItem.metadata, this.selectedItem.nbt)
              this.updateSlot(click.slot, item)
              this.fillSlotWithSelectedItem(item, false)
            }
          } else if (item) {
            if (click.slot !== this.craftingResultSlot) {
              this.splitSlot(item)
            } else {
              this.swapSelectedItem(click.slot, item)
            }
          }
        }
      }
    }

    shiftClick (click) {
      const { item } = click
      if (!item) return
      if (this.type === 'minecraft:inventory') {
        if (click.slot < this.inventoryStart) {
          this.fillAndDump(item, this.inventoryStart, this.inventoryEnd, click.slot === this.craftingResultSlot)
        } else {
          if (click.slot >= this.inventoryStart && click.slot < this.inventoryEnd - 10) {
            this.fillAndDump(item, this.hotbarStart, this.inventoryEnd)
          } else {
            this.fillAndDump(item, this.inventoryStart, this.inventoryEnd)
          }
        }
      } else {
        if (click.slot < this.inventoryStart) {
          this.fillAndDump(item, this.inventoryStart, this.inventoryEnd, this.craftingResultSlot === -1 || click.slot === this.craftingResultSlot)
        } else {
          this.fillAndDump(item, 0, this.inventoryStart - 1)
        }
      }
    }

    numberClick (click) {
      if (this.selectedItem) return
      const { item } = click
      const hotbarSlot = this.hotbarStart + click.mouseButton
      const itemAtHotbarSlot = this.slots[hotbarSlot]
      if (item) {
        if (itemAtHotbarSlot) {
          if (this.type === 'minecraft:inventory' || registry.version['>=']('1.9')) {
            this.updateSlot(click.slot, itemAtHotbarSlot)
            this.updateSlot(hotbarSlot, item)
          } else {
            this.dumpItem(itemAtHotbarSlot, this.hotbarStart, this.inventoryEnd)
            if (this.slots[hotbarSlot]) {
              this.dumpItem(itemAtHotbarSlot, this.inventoryStart, this.hotbarStart - 1)
            }
            if (this.slots[hotbarSlot] === null) {
              this.updateSlot(item.slot, null)
              this.updateSlot(hotbarSlot, item)
              let slots = this.findItemsRange(this.hotbarStart, this.inventoryEnd, itemAtHotbarSlot.type, itemAtHotbarSlot.metadata, true, itemAtHotbarSlot.nbt)
              slots.push(...this.findItemsRange(this.inventoryStart, this.hotbarStart - 1, itemAtHotbarSlot.type, itemAtHotbarSlot.metadata, true, itemAtHotbarSlot.nbt))
              slots = slots.filter(slot => slot.slot !== itemAtHotbarSlot.slot)
              this.fillSlotsWithItem(slots, itemAtHotbarSlot)
            }
          }
        } else {
          this.updateSlot(item.slot, null)
          this.updateSlot(hotbarSlot, item)
        }
      } else if (itemAtHotbarSlot && click.slot !== this.craftingResultSlot) {
        this.updateSlot(click.slot, itemAtHotbarSlot)
        this.updateSlot(hotbarSlot, null)
      }
    }

    middleClick (click, gamemode) {
      if (this.selectedItem) return
      const { item } = click
      if (gamemode === 1 && item) {
        this.selectedItem = new Item(item.type, item.stackSize, item.metadata, item.nbt)
      }
    }

    dropClick (click) {
      if (this.selectedItem) return
      if (click.mouseButton === 0) {
        if (--click.item.count === 0) this.updateSlot(click.slot, null)
      } else if (click.mouseButton === 1) {
        this.updateSlot(click.slot, null)
      }
    }

    dragClick (click, gamemode) {
      // unimplemented
      assert.ok(false, 'unimplemented')
    }

    doubleClick (click, bot) {
      if (this.selectedItem && (!click.item || !this.mayPickup(click.item, bot))) {
        let startingSlot = click.mouseButton === 0 ? 0 : window.slots.length - 1
        let addend = click.mouseButton === 0 ? 1 : -1

        for (k2 = 0; k2 < 2; ++k2) {
          for (k3 = startingSlot; k3 >= 0 && k3 < this.slots.length && this.selectedItem.count < this.selectedItem.stackSize; k3 += addend) {
            const slot8 = k3
            if (this.slots[slot8] && this.canItemQuickReplace(slot8, this.selectedItem, true) && this.mayPickup(slot8, bot) && this.canTakeItemForPickAll(this.selectedItem, slot8)) {
              const itemstack12 = this.slots[slot8]
              if (k2 !== 0 || itemstack12.count !== itemstack12.stackSize) {
                const itemstack13 = this.safeTake(slot8, itemstack12.count, this.selectedItem.stackSize - this.selectedItem.count, bot)
                this.selectedItem.count += itemstack13?.count ?? 0
              }
            }
          }
        }
      }
    }

    safeTake(slot, availableItemCount, amountToTake, bot) {
      const optional = this.tryRemove(slot, availableItemCount, amountToTake, bot)
      if (optional) this.updateSlot(slot, optional)

      return optional ?? null // its supposed to return itemstack empty but that doesnt really apply here
    }

    tryRemove(slot, availableItemCount, amountToTake, bot) {
      if (!this.mayPickup(slot, bot)) return null // if we cant pick up the item quit

      // if we cant modify the stack or take it all at once quit (could've used .mayPlace here, since allowmod = maypickup + mayplace)
      if (!this.allowModification(slot, bot) && amountToTake < this.slots[slot].count) return null

      availableItemCount = Math.min(availableItemCount, amountToTake)
      const itemstack = this.remove(slot, availableItemCount)

      if (!itemstack) return null
      if (!this.slots[slot]) this.updateSlot(slot, null)

      return itemstack
    }

    remove (slot, amount) {
      // not implemented cause bored
    }

    allowModification (slot, bot) {
      return this.mayPickup(slot, bot) && this.mayPlace(slot, this.slots[slot]);
    }

    mayPlace (slot, item) {
      if (slot === this.craftingResultSlot) return false
      if (this.type === 'minecraft:furnace' && slot === 1) return item.isFuel() || item.name === "bucket" // TO BE IMPLEMENTED todo
      if (this.type === 'minecraft:furnace' && slot === 2) return false
      if (this.type === 'minecraft:brewing_stand' && slot === 4) return item.name === "blaze_powder"
      if (this.type === 'minecraft:brewing_stand' && slot === 3) return item.isPotionIngredient() // TO BE IMPLEMENTED todo
      if (this.type === 'minecraft:brewing_stand' && slot >= 0 && slot <= 2) {
        return item.name === 'potion' || item.name === 'splash_potion' || item.name === 'lingering_potion' || item.name === 'glass_bottle'
      }
      if (this.type === 'minecraft:merchant' && slot === 2) return false
      if (this.type === 'minecraft:beacon' && slot === 0) return item.isBeaconPaymentItem() // TO BE IMPLEMENTED todo
      if (this.type === 'minecraft:cartography_table' && slot === 0) return item.name === 'filled_map'
      if (this.type === 'minecraft:cartography_table' && slot === 1) {
        return item.name === 'paper' || item.name === 'map' || item.name === 'glass_pane'
      }
      if (this.type === 'minecraft:cartography_table' && slot === 2) return false
      if (this.type === 'minecraft:enchanting_table' && slot === 0) return true
      if (this.type === 'minecraft:enchanting_table' && slot === 1) return item.name === 'lapis_lazuli'
      if (this.type === 'minecraft:grindstone' && slot === 0) {
        return registry.items[item.type].maxDurability > 0 || item.name === 'enchanted_book' || item.enchants
      }
      if (this.type === 'minecraft:grindstone' && slot === 1) {
        return registry.items[item.type].maxDurability > 0 || item.name === 'enchanted_book' || item.enchants
      }
      if (this.type === 'minecraft:grindstone' && slot === 2) return false
      // TODO: add the horse/llama entity as a property of the window so that we can call isSaddlable
      // todo: EntityLlama is not a real window name, check whats up with that
      if (this.type === 'EntityHorse' && slot === 0) return item.name === 'saddle' && this.slots[slot] === null // horse cant be a baby, has to be tamed, and has to be alive
      if (this.type === 'EntityHorse' && slot === 1) return item.isHorseArmor() // TO BE IMPLEMENTED todo
      if (this.type === 'EntityLlama' && slot === 0) return item.isWoolCarpet() && this.slots[slot] === null // horse cant be a baby, has to be tamed, and has to be alive
      if (this.id === 0 && slot === 5) return item.isHelmet() // TODO: implement
      if (this.id === 0 && slot === 6) return item.isChestplate() // TODO: implement
      if (this.id === 0 && slot === 7) return item.isLeggings() // TODO: implement
      if (this.id === 0 && slot === 8) return item.isBoots() // TODO: implement
      if ((this.type === 'minecraft:smithing_table' || this.type === 'minecraft:anvil') && slot === this.craftingResultSlot) return false
      if (this.type === 'minecraft:anvil' && (slot === 0 || slot === 1)) return true
      if (this.type === 'minecraft:smithing_table' && (slot === 0 || slot === 1 || registry.version['>=']('1.20') ? slot === 2 : false)) {
        return true // TODO: add recipe checking, this does not work lol
      }
      if (this.type === 'minecraft:loom' && slot === 0) return item.isBanner() // TODO: implement
      if (this.type === 'minecraft:loom' && slot === 1) return item.isDye() // TODO: implement
      if (this.type === 'minecraft:loom' && slot === 2) return item.isBannerPattern() // TODO: implement
      if (this.type === 'minecraft:loom' && slot === 3) return false
      if (this.type === 'minecraft:stonecutter' && slot === 1) return false
      return true // if there are no overrides, assume its a net.minecraft.world.inventory.Slot
    }

    mayPickup(slot, bot) {
      // TODO: replace creative with instabuild ability
      if (slot === this.craftingResultSlot && this.type === 'minecraft:anvil') {
          const xpCost = Item.anvil(this.slots[0], this.slots[1], bot.game.gameMode === 'creative').xpCost
          return (bot.game.gameMode === 'creative' || bot.experience.level >= xpCost) && xpCost > 0
      }
      // STILL TESTING RECIPES FOR SMITHING TABLE, DOESNT WORK (todo)
      if (slot === this.craftingResultSlot && this.type === 'minecraft:smithing_table') {
          return this.slots[2] !== null && this.selectedRecipe.matches(this.inputSlots, this.level)
      }
      if (this.id === 0 && slot >= 5 && slot <= 8) {
        const itemstack = this.slots[slot]
        return (itemstack && bot.game.gameMode !== 'creative' && itemstack.hasBindingCurse()) ? false : true
      }

      return true // assume its a net.minecraft.world.inventory.Slot if no overrides happen
  }

    canTakeItemForPickAll (item, slot) {
      if (this.type === 'minecraft:cartography_table') return slot !== this.craftingResultSlot && true
      if (this.type === 'minecraft:crafting_table') return slot !== this.craftingResultSlot && true
      if (this.id === 0) return slot !== this.craftingResultSlot && true
      if (this.type === 'minecraft:merchant') return false
      if (this.type === 'minecraft:smithing_table') return slot !== this.craftingResultSlot && true
      if (this.type === 'minecraft:stonecutter') return slot !== this.craftingResultSlot && true
      return true // assume its an AbstractContainerMenu if no overrides happen
    }

    canItemQuickReplace(slot, item, ignoreItemCount) {
      const isSlotEmpty = slot == null || !this.slots[slot] // == null means null or undefined
      if (!isSlotEmpty && Item.equal(this.slots[slot], item, false)) {
        return (this.slots[slot].count + (ignoreItemCount ? 0 : item.count)) <= item.stackSize
      } else {
        return isSlotEmpty
      }
    }

    acceptOutsideWindowClick = this.acceptClick
    acceptInventoryClick = this.acceptClick
    acceptNonInventorySwapAreaClick = this.acceptClick
    acceptSwapAreaLeftClick = this.acceptClick
    acceptSwapAreaRightClick = this.acceptClick
    acceptCraftingClick = this.acceptClick

    fillAndDump (item, start, end, lastToFirst = false) {
      this.fillSlotsWithItem(this.findItemsRange(start, end, item.type, item.metadata, true, item.nbt, true), item, lastToFirst)
      if (this.slots[item.slot]) {
        this.dumpItem(item, start, end, lastToFirst)
      }
    }

    fillSlotsWithItem (slots, item, lastToFirst = false) {
      while (slots.length && item.count) {
        this.fillSlotWithItem(lastToFirst ? slots.pop() : slots.shift(), item)
      }
    }

    fillSlotWithItem (itemToFill, itemToTake) {
      const newCount = itemToFill.count + itemToTake.count
      const leftover = newCount - itemToFill.stackSize
      if (leftover <= 0) {
        itemToFill.count = newCount
        itemToTake.count = 0
        this.updateSlot(itemToTake.slot, null)
      } else {
        itemToFill.count = itemToFill.stackSize
        itemToTake.count = leftover
      }
    }

    fillSlotWithSelectedItem (item, untilFull) {
      if (untilFull) {
        const newCount = item.count + this.selectedItem.count
        const leftover = newCount - item.stackSize
        if (leftover <= 0) {
          item.count = newCount
          this.selectedItem = null
        } else {
          item.count = item.stackSize
          this.selectedItem.count = leftover
        }
      } else {
        if (item.count + 1 <= item.stackSize) {
          item.count++
          if (--this.selectedItem.count === 0) this.selectedItem = null
        }
      }
    }

    dumpItem (item, start, end, lastToFirst = false) {
      const emptySlot = lastToFirst ? this.lastEmptySlotRange(start, end) : this.firstEmptySlotRange(start, end)
      if (emptySlot !== null && emptySlot !== this.craftingResultSlot) {
        const slot = item.slot
        this.updateSlot(emptySlot, item)
        this.updateSlot(slot, null)
      }
    }

    splitSlot (item) {
      if (!item) return
      this.selectedItem = new Item(item.type, Math.ceil(item.count / 2), item.metadata, item.nbt)
      item.count -= this.selectedItem.count
      if (item.count === 0) this.updateSlot(item.slot, null)
    }

    swapSelectedItem (slot, item) {
      this.updateSlot(slot, this.selectedItem)
      this.selectedItem = item
    }

    dropSelectedItem (untilEmpty) {
      if (untilEmpty || --this.selectedItem.count === 0) this.selectedItem = null
    }

    updateSlot (slot, newItem) {
      if (newItem) newItem.slot = slot
      const oldItem = this.slots[slot]
      this.slots[slot] = newItem

      this.emit('updateSlot', slot, oldItem, newItem)
      this.emit(`updateSlot:${slot}`, oldItem, newItem)
    }

    findItemsRange (start, end, itemType, metadata, notFull, nbt, withoutCraftResultSlot = false) {
      const items = []
      while (start < end) {
        const item = this.findItemRange(start, end, itemType, metadata, notFull, nbt, withoutCraftResultSlot)
        if (!item) break
        start = item.slot + 1
        items.push(item)
      }
      return items
    }

    findItemRange (start, end, itemType, metadata, notFull, nbt, withoutCraftResultSlot = false) {
      assert.notStrictEqual(itemType, null)
      for (let i = start; i < end; ++i) {
        const item = this.slots[i]
        if (
          item && itemType === item.type &&
          (metadata == null || metadata === item.metadata) &&
          (!notFull || item.count < item.stackSize) &&
          (nbt == null || JSON.stringify(nbt) === JSON.stringify(item.nbt)) &&
          !(item.slot === this.craftingResultSlot && withoutCraftResultSlot)) {
          return item
        }
      }
      return null
    }

    findItemRangeName (start, end, itemName, metadata, notFull) {
      assert.notStrictEqual(itemName, null)
      for (let i = start; i < end; ++i) {
        const item = this.slots[i]
        if (item && itemName === item.name &&
          (metadata == null || metadata === item.metadata) &&
          (!notFull || item.count < item.stackSize)) {
          return item
        }
      }
      return null
    }

    findInventoryItem (item, metadata, notFull) {
      assert(typeof item === 'number' || typeof item === 'string' || typeof item === 'undefined', 'No valid type given')
      return typeof item === 'number'
        ? this.findItemRange(this.inventoryStart, this.inventoryEnd, item, metadata, notFull)
        : this.findItemRangeName(this.inventoryStart, this.inventoryEnd, item, metadata, notFull)
    }

    findContainerItem (item, metadata, notFull) {
      assert(typeof item === 'number' || typeof item === 'string' || typeof item === 'undefined', 'No valid type given')
      return typeof item === 'number'
        ? this.findItemRange(0, this.inventoryStart, item, metadata, notFull)
        : this.findItemRangeName(0, this.inventoryStart, item, metadata, notFull)
    }

    firstEmptySlotRange (start, end) {
      for (let i = start; i < end; ++i) {
        if (this.slots[i] === null) return i
      }
      return null
    }

    lastEmptySlotRange (start, end) {
      for (let i = end; i >= start; i--) {
        if (this.slots[i] === null) return i
      }
      return null
    }

    firstEmptyHotbarSlot () {
      return this.firstEmptySlotRange(this.hotbarStart, this.inventoryEnd)
    }

    firstEmptyContainerSlot () {
      return this.firstEmptySlotRange(0, this.inventoryStart)
    }

    firstEmptyInventorySlot (hotbarFirst = true) {
      if (hotbarFirst) {
        const slot = this.firstEmptyHotbarSlot()
        if (slot !== null) return slot
      }
      return this.firstEmptySlotRange(this.inventoryStart, this.inventoryEnd)
    }

    sumRange (start, end) {
      let sum = 0
      for (let i = start; i < end; i++) {
        const item = this.slots[i]
        if (item) sum += item.count
      }
      return sum
    }

    countRange (start, end, itemType, metadata) {
      let sum = 0
      for (let i = start; i < end; ++i) {
        const item = this.slots[i]
        if (item && itemType === item.type &&
          (metadata == null || item.metadata === metadata)) {
          sum += item.count
        }
      }
      return sum
    }

    itemsRange (start, end) {
      const results = []
      for (let i = start; i < end; ++i) {
        const item = this.slots[i]
        if (item) results.push(item)
      }
      return results
    }

    count (itemType, metadata) {
      itemType = parseInt(itemType, 10) // allow input to be string
      return this.countRange(this.inventoryStart, this.inventoryEnd, itemType, metadata)
    }

    items () {
      return this.itemsRange(this.inventoryStart, this.inventoryEnd)
    }

    containerCount (itemType, metadata) {
      itemType = parseInt(itemType, 10) // allow input to be string
      return this.countRange(0, this.inventoryStart, itemType, metadata)
    }

    containerItems () {
      return this.itemsRange(0, this.inventoryStart)
    }

    emptySlotCount () {
      let count = 0
      for (let i = this.inventoryStart; i < this.inventoryEnd; ++i) {
        if (this.slots[i] === null) count += 1
      }
      return count
    }

    transactionRequiresConfirmation (click) {
      return this.requiresConfirmation
    }

    getChangedSlotsAsNotch (slots1, slots2) {
      assert.equal(slots1.length, slots2.length)

      const changedSlots = []

      for (let i = 0; i < slots2.length; i++) {
        if (!Item.equal(slots1[i], slots2[i])) {
          changedSlots.push({
            location: i,
            item: Item.toNotch(slots2[i])
          })
        }
      }

      return changedSlots
    }

    clear (blockId, count) {
      let clearedCount = 0

      const iterLoop = (currSlot) => {
        if (!currSlot || (blockId && currSlot.type !== blockId)) return false
        const blocksNeeded = count - clearedCount
        if (count && currSlot.count > blocksNeeded) { // stack is bigger then needed
          clearedCount += blocksNeeded
          this.updateSlot(currSlot.slot, new Item(blockId, currSlot.count - blocksNeeded, currSlot.metadata, currSlot.nbt))
        } else { // stack is just big enough or too little items to finish counter
          clearedCount += currSlot.count
          this.updateSlot(currSlot.slot, null)
        }
        if (count === clearedCount) return true // we have enough items
        return false
      }

      for (let i = this.inventoryEnd; i > this.hotbarStart - 1; i--) {
        if (iterLoop(this.slots[i])) break
      }

      if (clearedCount !== count) {
        for (let i = this.inventoryStart; i < this.hotbarStart; i++) {
          if (iterLoop(this.slots[i])) break
        }
      }

      return clearedCount
    }
  }
}
