// frontend/components/CustomIconSelect/CustomIconSelect.js
import React, { useState, useEffect, useRef, useMemo } from 'react';
import PropTypes from 'prop-types';
import {
  SelectWrapper,
  SelectTrigger,
  OptionsList,
  OptionItem,
  CategoryHeader,
  SearchInputWrapper,
  SearchInput
} from './CustomIconSelect.styled.js';

// --- Import ALL potential icons ---
// Adjust path '../../assets/actionBarItems/' if needed
import fallbackIconImport from '../../assets/actionBarItems/Tile_Highlight_Effect.gif'; // Assuming this is the fallback icon
import Animate_DeadIcon from '../../assets/actionBarItems/Animate_Dead.gif';
import AnnihilationIcon from '../../assets/actionBarItems/Annihilation.gif';
import Antidote_PotionIcon from '../../assets/actionBarItems/Antidote_Potion.gif';
import Apprentices_StrikeIcon from '../../assets/actionBarItems/Apprentices_Strike.gif';
import Arrow_CallIcon from '../../assets/actionBarItems/Arrow_Call.gif';
import Avatar_of_BalanceIcon from '../../assets/actionBarItems/Avatar_of_Balance.gif';
import Avatar_of_LightIcon from '../../assets/actionBarItems/Avatar_of_Light.gif';
import Avatar_of_NatureIcon from '../../assets/actionBarItems/Avatar_of_Nature.gif';
import Avatar_of_SteelIcon from '../../assets/actionBarItems/Avatar_of_Steel.gif';
import Avatar_of_StormIcon from '../../assets/actionBarItems/Avatar_of_Storm.gif';
import Balanced_BrawlIcon from '../../assets/actionBarItems/Balanced_Brawl.gif';
import BerserkIcon from '../../assets/actionBarItems/Berserk.gif';
import Berserk_PotionIcon from '../../assets/actionBarItems/Berserk_Potion.gif';
import Bestiary_BettermentIcon from '../../assets/actionBarItems/Bestiary_Betterment.gif';
import Blood_RageIcon from '../../assets/actionBarItems/Blood_Rage.gif';
import Bruise_BaneIcon from '../../assets/actionBarItems/Bruise_Bane.gif';
import Brutal_StrikeIcon from '../../assets/actionBarItems/Brutal_Strike.gif';
import Bullseye_PotionIcon from '../../assets/actionBarItems/Bullseye_Potion.gif';
import BuzzIcon from '../../assets/actionBarItems/Buzz.gif';
import Cancel_InvisibilityIcon from '../../assets/actionBarItems/Cancel_Invisibility.gif';
import Cancel_Magic_ShieldIcon from '../../assets/actionBarItems/Cancel_Magic_Shield.gif';
import Magic_Shield_PotionIcon from '../../assets/actionBarItems/Magic_Shield_Potion.gif';
import Chained_PenanceIcon from '../../assets/actionBarItems/Chained_Penance.gif';
import ChallengeIcon from '../../assets/actionBarItems/Challenge.gif';
import ChameleonIcon from '../../assets/actionBarItems/Chameleon.gif';
import ChargeIcon from '../../assets/actionBarItems/Charge.gif';
import Charm_UpgradeIcon from '../../assets/actionBarItems/Charm_Upgrade.gif';
import Chill_OutIcon from '../../assets/actionBarItems/Chill_Out.gif';
import Chivalrous_ChallengeIcon from '../../assets/actionBarItems/Chivalrous_Challenge.gif';
import Conjure_ArrowIcon from '../../assets/actionBarItems/Conjure_Arrow.gif';
import Conjure_Explosive_ArrowIcon from '../../assets/actionBarItems/Conjure_Explosive_Arrow.gif';
import Conjure_Wand_of_DarknessIcon from '../../assets/actionBarItems/Conjure_Wand_of_Darkness.gif';
import Convince_CreatureIcon from '../../assets/actionBarItems/Convince_Creature.gif';
import Creature_IllusionIcon from '../../assets/actionBarItems/Creature_Illusion.gif';
import Cure_BleedingIcon from '../../assets/actionBarItems/Cure_Bleeding.gif';
import Cure_BurningIcon from '../../assets/actionBarItems/Cure_Burning.gif';
import Cure_CurseIcon from '../../assets/actionBarItems/Cure_Curse.gif';
import Cure_ElectrificationIcon from '../../assets/actionBarItems/Cure_Electrification.gif';
import Cure_PoisonIcon from '../../assets/actionBarItems/Cure_Poison.gif';
import CurseIcon from '../../assets/actionBarItems/Curse.gif';
import Death_AmplificationIcon from '../../assets/actionBarItems/Death_Amplification.gif';
import Death_ResilienceIcon from '../../assets/actionBarItems/Death_Resilience.gif';
import Death_StrikeIcon from '../../assets/actionBarItems/Death_Strike.gif';
import Destroy_FieldIcon from '../../assets/actionBarItems/Destroy_Field.gif';
import Devastating_KnockoutIcon from '../../assets/actionBarItems/Devastating_Knockout.gif';
import DisintegrateIcon from '../../assets/actionBarItems/Disintegrate.gif';
import Divine_CalderaIcon from '../../assets/actionBarItems/Divine_Caldera.gif';
import Divine_DazzleIcon from '../../assets/actionBarItems/Divine_Dazzle.gif';
import Divine_EmpowermentIcon from '../../assets/actionBarItems/Divine_Empowerment.gif';
import Divine_GrenadeIcon from '../../assets/actionBarItems/Divine_Grenade.gif';
import Divine_HealingIcon from '../../assets/actionBarItems/Divine_Healing.gif';
import Divine_MissileIcon from '../../assets/actionBarItems/Divine_Missile.gif';
import Double_JabIcon from '../../assets/actionBarItems/Double_Jab.gif';
import Earth_AmplificationIcon from '../../assets/actionBarItems/Earth_Amplification.gif';
import Earth_ResilienceIcon from '../../assets/actionBarItems/Earth_Resilience.gif';
import ElectrifyIcon from '../../assets/actionBarItems/Electrify.gif';
import Enchant_PartyIcon from '../../assets/actionBarItems/Enchant_Party.gif';
import Enchant_SpearIcon from '../../assets/actionBarItems/Enchant_Spear.gif';
import Energy_AmplificationIcon from '../../assets/actionBarItems/Energy_Amplification.gif';
import Energy_BeamIcon from '../../assets/actionBarItems/Energy_Beam.gif';
import Energy_BombIcon from '../../assets/actionBarItems/Energy_Bomb.gif';
import Energy_FieldIcon from '../../assets/actionBarItems/Energy_Field.gif';
import Energy_ResilienceIcon from '../../assets/actionBarItems/Energy_Resilience.gif';
import Energy_StrikeIcon from '../../assets/actionBarItems/Energy_Strike.gif';
import Energy_WallIcon from '../../assets/actionBarItems/Energy_Wall.gif';
import Energy_WaveIcon from '../../assets/actionBarItems/Energy_Wave.gif';
import Enlighten_PartyIcon from '../../assets/actionBarItems/Enlighten_Party.gif';
import EnvenomIcon from '../../assets/actionBarItems/Envenom.gif';
import Eternal_WinterIcon from '../../assets/actionBarItems/Eternal_Winter.gif';
import Ethereal_SpearIcon from '../../assets/actionBarItems/Ethereal_Spear.gif';
import Executioners_ThrowIcon from '../../assets/actionBarItems/Executioners_Throw.gif';
import ExplosionRuneIcon from '../../assets/actionBarItems/Explosion_Rune.gif';
import CreateExplosionRuneIcon from '../../assets/actionBarItems/Create_Explosion_Rune.gif';
import Expose_WeaknessIcon from '../../assets/actionBarItems/Expose_Weakness.gif';
import Fair_Wound_CleansingIcon from '../../assets/actionBarItems/Fair_Wound_Cleansing.gif';
import Fierce_BerserkIcon from '../../assets/actionBarItems/Fierce_Berserk.gif';
import Find_FiendIcon from '../../assets/actionBarItems/Find_Fiend.gif';
import Find_PersonIcon from '../../assets/actionBarItems/Find_Person.gif';
import Fire_AmplificationIcon from '../../assets/actionBarItems/Fire_Amplification.gif';
import FireballIcon from '../../assets/actionBarItems/Fireball.gif';
import Fire_BombIcon from '../../assets/actionBarItems/Fire_Bomb.gif';
import Fire_FieldIcon from '../../assets/actionBarItems/Fire_Field.gif';
import Fire_ResilienceIcon from '../../assets/actionBarItems/Fire_Resilience.gif';
import Fire_WallIcon from '../../assets/actionBarItems/Fire_Wall.gif';
import Fire_WaveIcon from '../../assets/actionBarItems/Fire_Wave.gif';
import Flame_StrikeIcon from '../../assets/actionBarItems/Flame_Strike.gif';
import Flurry_of_BlowsIcon from '../../assets/actionBarItems/Flurry_of_Blows.gif';
import Focus_HarmonyIcon from '../../assets/actionBarItems/Focus_Harmony.gif';
import Focus_SerenityIcon from '../../assets/actionBarItems/Focus_Serenity.gif';
import Food_SpellIcon from '../../assets/actionBarItems/Food_Spell.gif';
import Forceful_UppercutIcon from '../../assets/actionBarItems/Forceful_Uppercut.gif';
import Front_SweepIcon from '../../assets/actionBarItems/Front_Sweep.gif';
import Gift_of_LifeIcon from '../../assets/actionBarItems/Gift_of_Life.gif';
import Great_Death_BeamIcon from '../../assets/actionBarItems/Great_Death_Beam.gif';
import Great_Energy_BeamIcon from '../../assets/actionBarItems/Great_Energy_Beam.gif';
import Greater_Flurry_of_BlowsIcon from '../../assets/actionBarItems/Greater_Flurry_of_Blows.gif';
import Greater_Tiger_ClashIcon from '../../assets/actionBarItems/Greater_Tiger_Clash.gif';
import Great_Health_PotionIcon from '../../assets/actionBarItems/Great_Health_Potion.gif';
import Great_LightIcon from '../../assets/actionBarItems/Great_Light.gif';
import Great_Mana_PotionIcon from '../../assets/actionBarItems/Great_Mana_Potion.gif';
import Great_Spirit_PotionIcon from '../../assets/actionBarItems/Great_Spirit_Potion.gif';
import GroundshakerIcon from '../../assets/actionBarItems/Groundshaker.gif';
import HasteIcon from '../../assets/actionBarItems/Haste.gif';
import Heal_FriendIcon from '../../assets/actionBarItems/Heal_Friend.gif';
import Heal_PartyIcon from '../../assets/actionBarItems/Heal_Party.gif';
import Health_PotionIcon from '../../assets/actionBarItems/Health_Potion.gif';
import Heavy_Magic_MissileIcon from '../../assets/actionBarItems/Heavy_Magic_Missile.gif';
import Hells_CoreIcon from '../../assets/actionBarItems/Hells_Core.gif';
import Holy_AmplificationIcon from '../../assets/actionBarItems/Holy_Amplification.gif';
import Holy_FlashIcon from '../../assets/actionBarItems/Holy_Flash.gif';
import Holy_MissileIcon from '../../assets/actionBarItems/Holy_Missile.gif';
import Holy_ResilienceIcon from '../../assets/actionBarItems/Holy_Resilience.gif';
import Ice_AmplificationIcon from '../../assets/actionBarItems/Ice_Amplification.gif';
import Ice_BurstIcon from '../../assets/actionBarItems/Ice_Burst.gif';
import Ice_ResilienceIcon from '../../assets/actionBarItems/Ice_Resilience.gif';
import Ice_StrikeIcon from '../../assets/actionBarItems/Ice_Strike.gif';
import Ice_WaveIcon from '../../assets/actionBarItems/Ice_Wave.gif';
import IcicleIcon from '../../assets/actionBarItems/Icicle.gif';
import IgniteIcon from '../../assets/actionBarItems/Ignite.gif';
import Inflict_WoundIcon from '../../assets/actionBarItems/Inflict_Wound.gif';
import Intense_HealingIcon from '../../assets/actionBarItems/Intense_Healing.gif';
import Intense_Healing_RuneIcon from '../../assets/actionBarItems/Intense_Healing_Rune.gif';
import Intense_RecoveryIcon from '../../assets/actionBarItems/Intense_Recovery.gif';
import Intense_Wound_CleansingIcon from '../../assets/actionBarItems/Intense_Wound_Cleansing.gif';
import InvisibleIcon from '../../assets/actionBarItems/Invisible.gif';
import KooldownAidIcon from '../../assets/actionBarItems/Kooldown-Aid.gif';
import Lesser_Ethereal_SpearIcon from '../../assets/actionBarItems/Lesser_Ethereal_Spear.gif';
import Lesser_Front_SweepIcon from '../../assets/actionBarItems/Lesser_Front_Sweep.gif';
import LevitateIcon from '../../assets/actionBarItems/Levitate.gif';
import LightIcon from '../../assets/actionBarItems/Light.gif';
import Light_HealingIcon from '../../assets/actionBarItems/Light_Healing.gif';
import Light_Magic_MissileIcon from '../../assets/actionBarItems/Light_Magic_Missile.gif';
import LightningIcon from '../../assets/actionBarItems/Lightning.gif';
import Magic_PatchIcon from '../../assets/actionBarItems/Magic_Patch.gif';
import Magic_RopeIcon from '../../assets/actionBarItems/Magic_Rope.gif';
import Magic_ShieldIcon from '../../assets/actionBarItems/Magic_Shield.gif';
import Magic_WallIcon from '../../assets/actionBarItems/Magic_Wall.gif';
import Create_Magic_Wall_RuneIcon from '../../assets/actionBarItems/Create_Magic_Wall_Rune.gif';
import Mana_PotionIcon from '../../assets/actionBarItems/Mana_Potion.gif';
import Mass_HealingIcon from '../../assets/actionBarItems/Mass_Healing.gif';
import Mass_Spirit_MendIcon from '../../assets/actionBarItems/Mass_Spirit_Mend.gif';
import Mastermind_PotionIcon from '../../assets/actionBarItems/Mastermind_Potion.gif';
import Transcendence_PotionIcon from '../../assets/actionBarItems/Transcendence_Potion.gif';
import Mentor_OtherIcon from '../../assets/actionBarItems/Mentor_Other.gif';
import Might_RingIcon from "../../assets/actionBarItems/Might_Ring.gif"
import Mud_AttackIcon from '../../assets/actionBarItems/Mud_Attack.gif';
import Mystic_RepulseIcon from '../../assets/actionBarItems/Mystic_Repulse.gif';
import Natures_EmbraceIcon from '../../assets/actionBarItems/Natures_Embrace.gif';
import ParalyseIcon from '../../assets/actionBarItems/Paralyse.gif';
import Physical_AmplificationIcon from '../../assets/actionBarItems/Physical_Amplification.gif';
import Physical_ResilienceIcon from '../../assets/actionBarItems/Physical_Resilience.gif';
import Physical_StrikeIcon from '../../assets/actionBarItems/Physical_Strike.gif';
import Poison_BombIcon from '../../assets/actionBarItems/Poison_Bomb.gif';
import Poison_FieldIcon from '../../assets/actionBarItems/Poison_Field.gif';
import Poison_WallIcon from '../../assets/actionBarItems/Poison_Wall.gif';
import Practise_Fire_WaveIcon from '../../assets/actionBarItems/Practise_Fire_Wave.gif';
import Practise_HealingIcon from '../../assets/actionBarItems/Practise_Healing.gif';
import Practise_Magic_MissileIcon from '../../assets/actionBarItems/Practise_Magic_Missile.gif';
import ProtectorIcon from '../../assets/actionBarItems/Protector.gif';
import Protect_PartyIcon from '../../assets/actionBarItems/Protect_Party.gif';
import Rage_of_the_SkiesIcon from '../../assets/actionBarItems/Rage_of_the_Skies.gif';
import RecoveryIcon from '../../assets/actionBarItems/Recovery.gif';
import RestorationIcon from '../../assets/actionBarItems/Restoration.gif';
import Restore_BalanceIcon from '../../assets/actionBarItems/Restore_Balance.gif';
import SalvationIcon from '../../assets/actionBarItems/Salvation.gif';
import Sap_StrengthIcon from '../../assets/actionBarItems/Sap_Strength.gif';
import ScorchIcon from '../../assets/actionBarItems/Scorch.gif';
import SharpshooterIcon from '../../assets/actionBarItems/Sharpshooter.gif';
import Small_Health_PotionIcon from '../../assets/actionBarItems/Small_Health_Potion.gif';
import SoulfireIcon from '../../assets/actionBarItems/Soulfire.gif';
import Spirit_MendIcon from '../../assets/actionBarItems/Spirit_Mend.gif';
import Spiritual_OutburstIcon from '../../assets/actionBarItems/Spiritual_Outburst.gif';
import StalagmiteIcon from '../../assets/actionBarItems/Stalagmite.gif';
import Stamina_ExtensionIcon from '../../assets/actionBarItems/Stamina_Extension.gif';
import Stone_Shower_RuneIcon from '../../assets/actionBarItems/Stone_Shower_Rune.gif';
import Strike_EnhancementIcon from '../../assets/actionBarItems/Strike_Enhancement.gif';
import Strong_Energy_StrikeIcon from '../../assets/actionBarItems/Strong_Energy_Strike.gif';
import Strong_Ethereal_SpearIcon from '../../assets/actionBarItems/Strong_Ethereal_Spear.gif';
import Strong_Flame_StrikeIcon from '../../assets/actionBarItems/Strong_Flame_Strike.gif';
import Strong_HasteIcon from '../../assets/actionBarItems/Strong_Haste.gif';
import Strong_Health_PotionIcon from '../../assets/actionBarItems/Strong_Health_Potion.gif';
import Strong_Ice_StrikeIcon from '../../assets/actionBarItems/Strong_Ice_Strike.gif';
import Strong_Ice_WaveIcon from '../../assets/actionBarItems/Strong_Ice_Wave.gif';
import Strong_Mana_PotionIcon from '../../assets/actionBarItems/Strong_Mana_Potion.gif';
import Strong_Terra_StrikeIcon from '../../assets/actionBarItems/Strong_Terra_Strike.gif';
import Summon_CreatureIcon from '../../assets/actionBarItems/Summon_Creature.gif';
import Summon_Druid_FamiliarIcon from '../../assets/actionBarItems/Summon_Druid_Familiar.gif';
import Summon_Knight_FamiliarIcon from '../../assets/actionBarItems/Summon_Knight_Familiar.gif';
import Summon_Monk_FamiliarIcon from '../../assets/actionBarItems/Summon_Monk_Familiar.gif';
import Summon_Paladin_FamiliarIcon from '../../assets/actionBarItems/Summon_Paladin_Familiar.gif';
import Summon_Sorcerer_FamiliarIcon from '../../assets/actionBarItems/Summon_Sorcerer_Familiar.gif';
import Supreme_Health_PotionIcon from '../../assets/actionBarItems/Supreme_Health_Potion.gif';
import Sweeping_TakedownIcon from '../../assets/actionBarItems/Sweeping_Takedown.gif';
import Swift_FootIcon from '../../assets/actionBarItems/Swift_Foot.gif';
import Swift_JabIcon from '../../assets/actionBarItems/Swift_Jab.gif';
import Terra_BurstIcon from '../../assets/actionBarItems/Terra_Burst.gif';
import Terra_StrikeIcon from '../../assets/actionBarItems/Terra_Strike.gif';
import Terra_WaveIcon from '../../assets/actionBarItems/Terra_Wave.gif';
import Tiger_ClashIcon from '../../assets/actionBarItems/Tiger_Clash.gif';
import Tile_Highlight_EffectIcon from '../../assets/actionBarItems/Tile_Highlight_Effect.gif';
import Train_PartyIcon from '../../assets/actionBarItems/Train_Party.gif';
import Ultimate_Energy_StrikeIcon from '../../assets/actionBarItems/Ultimate_Energy_Strike.gif';
import Ultimate_Flame_StrikeIcon from '../../assets/actionBarItems/Ultimate_Flame_Strike.gif';
import Ultimate_HealingIcon from '../../assets/actionBarItems/Ultimate_Healing.gif';
import Ultimate_Healing_RuneIcon from '../../assets/actionBarItems/Ultimate_Healing_Rune.gif';
import Ultimate_Health_PotionIcon from '../../assets/actionBarItems/Ultimate_Health_Potion.gif';
import Ultimate_Ice_StrikeIcon from '../../assets/actionBarItems/Ultimate_Ice_Strike.gif';
import Ultimate_LightIcon from '../../assets/actionBarItems/Ultimate_Light.gif';
import Ultimate_Mana_PotionIcon from '../../assets/actionBarItems/Ultimate_Mana_Potion.gif';
import Ultimate_Spirit_PotionIcon from '../../assets/actionBarItems/Ultimate_Spirit_Potion.gif';
import Ultimate_Terra_StrikeIcon from '../../assets/actionBarItems/Ultimate_Terra_Strike.gif';
import Virtue_of_HarmonyIcon from '../../assets/actionBarItems/Virtue_of_Harmony.gif';
import Virtue_of_JusticeIcon from '../../assets/actionBarItems/Virtue_of_Justice.gif';
import Virtue_of_SustainIcon from '../../assets/actionBarItems/Virtue_of_Sustain.gif';
import Wealth_DuplexIcon from '../../assets/actionBarItems/Wealth_Duplex.gif';
import Whirlwind_ThrowIcon from '../../assets/actionBarItems/Whirlwind_Throw.gif';
import Wild_GrowthIcon from '../../assets/actionBarItems/Wild_Growth.gif';
import Wound_CleansingIcon from '../../assets/actionBarItems/Wound_Cleansing.gif';
import Wrath_of_NatureIcon from '../../assets/actionBarItems/Wrath_of_Nature.gif';
import Great_Fireball_RuneIcon from '../../assets/actionBarItems/Great_Fireball_Rune.gif';
import Create_Great_Fireball_RuneIcon from '../../assets/actionBarItems/Create_Great_Fireball_Rune.gif';
import Avalanche_RuneIcon from '../../assets/actionBarItems/Avalanche_Rune.gif';
import Create_Avalanche_RuneIcon from '../../assets/actionBarItems/Create_Avalanche_Rune.gif';
import Thunderstorm_RuneIcon from '../../assets/actionBarItems/Thunderstorm_Rune.gif';
import Create_Thunderstorm_RuneIcon from '../../assets/actionBarItems/Create_Thunderstorm_Rune.gif';
import Sudden_Death_RuneIcon from '../../assets/actionBarItems/Sudden_Death_Rune.gif';
import Create_Sudden_Death_RuneIcon from '../../assets/actionBarItems/Create_Sudden_Death_Rune.gif';
import Create_Intense_Healing_RuneIcon from '../../assets/actionBarItems/Create_Intense_Healing_Rune.gif';
import Create_Ultimate_Healing_RuneIcon from '../../assets/actionBarItems/Create_Ultimate_Healing_Rune.gif';
import Create_Stone_Shower_RuneIcon from '../../assets/actionBarItems/Create_Stone_Shower_Rune.gif';
import Stone_Skin_AmuletIcon from '../../assets/actionBarItems/Stone_Skin_Amulet.gif';
import Energy_RingIcon from '../../assets/actionBarItems/Energy_Ring.gif';


// --- Create Icon Map ---
// Map the iconName strings (keys) to the imported variables (values)
// Ensure the keys here EXACTLY match the 'iconName' strings used in actionBarItems.js
const iconMap = {
  fallback: fallbackIconImport, // Fallback mapping
  Animate_Dead: Animate_DeadIcon,
  Annihilation: AnnihilationIcon,
  Antidote_Potion: Antidote_PotionIcon,
  Apprentices_Strike: Apprentices_StrikeIcon,
  Arrow_Call: Arrow_CallIcon,
  Avalanche: Avalanche_RuneIcon, // Rune ITEM mapping
  Create_Avalanche_Rune: Create_Avalanche_RuneIcon, // Rune CREATE mapping
  Avatar_of_Balance: Avatar_of_BalanceIcon,
  Avatar_of_Light: Avatar_of_LightIcon,
  Avatar_of_Nature: Avatar_of_NatureIcon,
  Avatar_of_Steel: Avatar_of_SteelIcon,
  Avatar_of_Storm: Avatar_of_StormIcon,
  Balanced_Brawl: Balanced_BrawlIcon,
  Berserk: BerserkIcon,
  Berserk_Potion: Berserk_PotionIcon,
  Bestiary_Betterment: Bestiary_BettermentIcon,
  Blood_Rage: Blood_RageIcon,
  Bruise_Bane: Bruise_BaneIcon,
  Brutal_Strike: Brutal_StrikeIcon,
  Bullseye_Potion: Bullseye_PotionIcon,
  Buzz: BuzzIcon,
  Cancel_Invisibility: Cancel_InvisibilityIcon,
  Cancel_Magic_Shield: Cancel_Magic_ShieldIcon,
  Chained_Penance: Chained_PenanceIcon,
  Challenge: ChallengeIcon,
  Chameleon: ChameleonIcon,
  Charge: ChargeIcon,
  Charm_Upgrade: Charm_UpgradeIcon,
  Chill_Out: Chill_OutIcon,
  Chivalrous_Challenge: Chivalrous_ChallengeIcon,
  Conjure_Arrow: Conjure_ArrowIcon,
  Conjure_Explosive_Arrow: Conjure_Explosive_ArrowIcon,
  Conjure_Wand_of_Darkness: Conjure_Wand_of_DarknessIcon,
  Convince_Creature: Convince_CreatureIcon,
  Creature_Illusion: Creature_IllusionIcon,
  Cure_Bleeding: Cure_BleedingIcon,
  Cure_Burning: Cure_BurningIcon,
  Cure_Curse: Cure_CurseIcon,
  Cure_Electrification: Cure_ElectrificationIcon,
  Cure_Poison: Cure_PoisonIcon,
  Curse: CurseIcon,
  Death_Amplification: Death_AmplificationIcon,
  Death_Resilience: Death_ResilienceIcon,
  Death_Strike: Death_StrikeIcon,
  Destroy_Field: Destroy_FieldIcon,
  Devastating_Knockout: Devastating_KnockoutIcon,
  Disintegrate: DisintegrateIcon,
  Divine_Caldera: Divine_CalderaIcon,
  Divine_Dazzle: Divine_DazzleIcon,
  Divine_Empowerment: Divine_EmpowermentIcon,
  Divine_Grenade: Divine_GrenadeIcon,
  Divine_Healing: Divine_HealingIcon,
  Divine_Missile: Divine_MissileIcon,
  Double_Jab: Double_JabIcon,
  Earth_Amplification: Earth_AmplificationIcon,
  Earth_Resilience: Earth_ResilienceIcon,
  Electrify: ElectrifyIcon,
  Enchant_Party: Enchant_PartyIcon,
  Enchant_Spear: Enchant_SpearIcon,
  Energy_Amplification: Energy_AmplificationIcon,
  Energy_Beam: Energy_BeamIcon,
  Energy_Bomb: Energy_BombIcon,
  Energy_Field: Energy_FieldIcon,
  Energy_Resilience: Energy_ResilienceIcon,
  Energy_Strike: Energy_StrikeIcon,
  Energy_Wall: Energy_WallIcon,
  Energy_Wave: Energy_WaveIcon,
  Enlighten_Party: Enlighten_PartyIcon,
  Envenom: EnvenomIcon,
  Eternal_Winter: Eternal_WinterIcon,
  Ethereal_Spear: Ethereal_SpearIcon,
  Executioners_Throw: Executioners_ThrowIcon,
  Explosion_Rune: ExplosionRuneIcon,
  Create_Explosion_Rune: CreateExplosionRuneIcon,
  Expose_Weakness: Expose_WeaknessIcon,
  Fair_Wound_Cleansing: Fair_Wound_CleansingIcon,
  Fierce_Berserk: Fierce_BerserkIcon,
  Find_Fiend: Find_FiendIcon,
  Find_Person: Find_PersonIcon,
  Fire_Amplification: Fire_AmplificationIcon,
  Fireball: FireballIcon,
  Fire_Bomb: Fire_BombIcon,
  Fire_Field: Fire_FieldIcon,
  Fire_Resilience: Fire_ResilienceIcon,
  Fire_Wall: Fire_WallIcon,
  Fire_Wave: Fire_WaveIcon,
  Flame_Strike: Flame_StrikeIcon,
  Flurry_of_Blows: Flurry_of_BlowsIcon,
  Focus_Harmony: Focus_HarmonyIcon,
  Focus_Serenity: Focus_SerenityIcon,
  Food_Spell: Food_SpellIcon,
  Forceful_Uppercut: Forceful_UppercutIcon,
  Front_Sweep: Front_SweepIcon,
  Gift_of_Life: Gift_of_LifeIcon,
  Great_Death_Beam: Great_Death_BeamIcon,
  Great_Energy_Beam: Great_Energy_BeamIcon,
  Greater_Flurry_of_Blows: Greater_Flurry_of_BlowsIcon,
  Greater_Tiger_Clash: Greater_Tiger_ClashIcon,
  Great_Health_Potion: Great_Health_PotionIcon,
  Great_Light: Great_LightIcon,
  Great_Mana_Potion: Great_Mana_PotionIcon,
  Great_Spirit_Potion: Great_Spirit_PotionIcon,
  Groundshaker: GroundshakerIcon,
  Haste: HasteIcon,
  Heal_Friend: Heal_FriendIcon,
  Heal_Party: Heal_PartyIcon,
  Health_Potion: Health_PotionIcon,
  Heavy_Magic_Missile: Heavy_Magic_MissileIcon,
  Hells_Core: Hells_CoreIcon,
  Holy_Amplification: Holy_AmplificationIcon,
  Holy_Flash: Holy_FlashIcon,
  Holy_Missile: Holy_MissileIcon,
  Holy_Resilience: Holy_ResilienceIcon,
  Ice_Amplification: Ice_AmplificationIcon,
  Ice_Burst: Ice_BurstIcon,
  Ice_Resilience: Ice_ResilienceIcon,
  Ice_Strike: Ice_StrikeIcon,
  Ice_Wave: Ice_WaveIcon,
  Icicle: IcicleIcon,
  Ignite: IgniteIcon,
  Inflict_Wound: Inflict_WoundIcon,
  Intense_Healing: Intense_HealingIcon,
  Intense_Healing_Rune: Intense_Healing_RuneIcon, // Rune ITEM mapping
  Create_Intense_Healing_Rune: Create_Intense_Healing_RuneIcon, // Rune CREATE mapping
  Intense_Recovery: Intense_RecoveryIcon,
  Intense_Wound_Cleansing: Intense_Wound_CleansingIcon,
  Invisible: InvisibleIcon,
  'Kooldown-Aid': KooldownAidIcon,
  Lesser_Ethereal_Spear: Lesser_Ethereal_SpearIcon,
  Lesser_Front_Sweep: Lesser_Front_SweepIcon,
  Levitate: LevitateIcon,
  Light: LightIcon,
  Light_Healing: Light_HealingIcon,
  Light_Magic_Missile: Light_Magic_MissileIcon,
  Lightning: LightningIcon,
  Magic_Patch: Magic_PatchIcon,
  Magic_Rope: Magic_RopeIcon,
  Magic_Shield: Magic_ShieldIcon,
  Magic_Shield_Potion: Magic_Shield_PotionIcon,
  Magic_Wall: Magic_WallIcon,
  Create_Magic_Wall_Rune: Create_Magic_Wall_RuneIcon,
  Mana_Potion: Mana_PotionIcon,
  Mass_Healing: Mass_HealingIcon,
  Mass_Spirit_Mend: Mass_Spirit_MendIcon,
  Mastermind_Potion: Mastermind_PotionIcon,
  Transcendence_Potion: Transcendence_PotionIcon,
  Mentor_Other: Mentor_OtherIcon,
  Might_Ring: Might_RingIcon,
  Mud_Attack: Mud_AttackIcon,
  Mystic_Repulse: Mystic_RepulseIcon,
  Natures_Embrace: Natures_EmbraceIcon,
  Paralyse: ParalyseIcon,
  Physical_Amplification: Physical_AmplificationIcon,
  Physical_Resilience: Physical_ResilienceIcon,
  Physical_Strike: Physical_StrikeIcon,
  Poison_Bomb: Poison_BombIcon,
  Poison_Field: Poison_FieldIcon,
  Poison_Wall: Poison_WallIcon,
  Practise_Fire_Wave: Practise_Fire_WaveIcon,
  Practise_Healing: Practise_HealingIcon,
  Practise_Magic_Missile: Practise_Magic_MissileIcon,
  Protector: ProtectorIcon,
  Protect_Party: Protect_PartyIcon,
  Rage_of_the_Skies: Rage_of_the_SkiesIcon,
  Recovery: RecoveryIcon,
  Restoration: RestorationIcon,
  Restore_Balance: Restore_BalanceIcon,
  Salvation: SalvationIcon,
  Sap_Strength: Sap_StrengthIcon,
  Scorch: ScorchIcon,
  Sharpshooter: SharpshooterIcon,
  Small_Health_Potion: Small_Health_PotionIcon,
  Soulfire: SoulfireIcon,
  Spirit_Mend: Spirit_MendIcon,
  Spiritual_Outburst: Spiritual_OutburstIcon,
  Stalagmite: StalagmiteIcon,
  Stamina_Extension: Stamina_ExtensionIcon,
  Stone_Shower: Stone_Shower_RuneIcon, // Rune ITEM mapping
  Create_Stone_Shower_Rune: Create_Stone_Shower_RuneIcon, // Rune CREATE mapping
  Stone_Skin_Amulet: Stone_Skin_AmuletIcon,
  Strike_Enhancement: Strike_EnhancementIcon,
  Strong_Energy_Strike: Strong_Energy_StrikeIcon,
  Strong_Ethereal_Spear: Strong_Ethereal_SpearIcon,
  Strong_Flame_Strike: Strong_Flame_StrikeIcon,
  Strong_Haste: Strong_HasteIcon,
  Strong_Health_Potion: Strong_Health_PotionIcon,
  Strong_Ice_Strike: Strong_Ice_StrikeIcon,
  Strong_Ice_Wave: Strong_Ice_WaveIcon,
  Strong_Mana_Potion: Strong_Mana_PotionIcon,
  Strong_Terra_Strike: Strong_Terra_StrikeIcon,
  Summon_Creature: Summon_CreatureIcon,
  Summon_Druid_Familiar: Summon_Druid_FamiliarIcon,
  Summon_Knight_Familiar: Summon_Knight_FamiliarIcon,
  Summon_Monk_Familiar: Summon_Monk_FamiliarIcon,
  Summon_Paladin_Familiar: Summon_Paladin_FamiliarIcon,
  Summon_Sorcerer_Familiar: Summon_Sorcerer_FamiliarIcon,
  Supreme_Health_Potion: Supreme_Health_PotionIcon,
  Sweeping_Takedown: Sweeping_TakedownIcon,
  Swift_Foot: Swift_FootIcon,
  Swift_Jab: Swift_JabIcon,
  Terra_Burst: Terra_BurstIcon,
  Terra_Strike: Terra_StrikeIcon,
  Terra_Wave: Terra_WaveIcon,
  Tiger_Clash: Tiger_ClashIcon,
  Tile_Highlight_Effect: Tile_Highlight_EffectIcon,
  Train_Party: Train_PartyIcon,
  Ultimate_Energy_Strike: Ultimate_Energy_StrikeIcon,
  Ultimate_Flame_Strike: Ultimate_Flame_StrikeIcon,
  Ultimate_Healing: Ultimate_HealingIcon,
  Ultimate_Healing_Rune: Ultimate_Healing_RuneIcon, // Rune ITEM mapping
  Create_Ultimate_Healing_Rune: Create_Ultimate_Healing_RuneIcon, // Rune CREATE mapping
  Ultimate_Health_Potion: Ultimate_Health_PotionIcon,
  Ultimate_Ice_Strike: Ultimate_Ice_StrikeIcon,
  Ultimate_Light: Ultimate_LightIcon,
  Ultimate_Mana_Potion: Ultimate_Mana_PotionIcon,
  Ultimate_Spirit_Potion: Ultimate_Spirit_PotionIcon,
  Ultimate_Terra_Strike: Ultimate_Terra_StrikeIcon,
  Virtue_of_Harmony: Virtue_of_HarmonyIcon,
  Virtue_of_Justice: Virtue_of_JusticeIcon,
  Virtue_of_Sustain: Virtue_of_SustainIcon,
  Wealth_Duplex: Wealth_DuplexIcon,
  Whirlwind_Throw: Whirlwind_ThrowIcon,
  Wild_Growth: Wild_GrowthIcon,
  Wound_Cleansing: Wound_CleansingIcon,
  Wrath_of_Nature: Wrath_of_NatureIcon,
  Great_Fireball: Great_Fireball_RuneIcon, // Rune ITEM mapping
  Create_Great_Fireball_Rune: Create_Great_Fireball_RuneIcon, // Rune CREATE mapping
  Avalanche: Avalanche_RuneIcon, // Rune ITEM mapping
  Create_Avalanche_Rune: Create_Avalanche_RuneIcon, // Rune CREATE mapping
  Thunderstorm: Thunderstorm_RuneIcon, // Rune ITEM mapping
  Create_Thunderstorm_Rune: Create_Thunderstorm_RuneIcon, // Rune CREATE mapping
  Sudden_Death: Sudden_Death_RuneIcon, // Rune ITEM mapping
  Create_Sudden_Death_Rune: Create_Sudden_Death_RuneIcon, // Rune CREATE mapping
  Energy_Ring: Energy_RingIcon, 
};

// Helper function now uses the map defined above
const getIconSrc = (itemValue, allItemsData, fallbackIconVar) => {
  const itemData = allItemsData?.[itemValue];
  const iconVariable = itemData?.iconName ? iconMap[itemData.iconName] : fallbackIconVar;
  return iconVariable || fallbackIconVar; // Ensure fallback if lookup returns undefined
};


const CustomIconSelect = ({
  id = 'custom-select',
  value,
  options,
  allItemsData, // This prop receives the data structure with 'iconName' strings
  onChange,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const wrapperRef = useRef(null);
  const searchInputRef = useRef(null);
  const optionsListRef = useRef(null);
  const activeItemRef = useRef(null);

  // Use the imported fallback directly when calling getIconSrc
  const selectedIconSrc = getIconSrc(value, allItemsData, fallbackIconImport);
  const selectedItemData = allItemsData?.[value] || {};
  const selectedItemName = selectedItemData.name || value || '';

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setIsOpen(false);
        setSearchTerm(''); // Clear search on close
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isOpen) {
       setActiveIndex(-1);
       // Ensure ref exists before trying to focus
       setTimeout(() => searchInputRef.current?.focus(), 0);
    }
  }, [isOpen]);

  // Scroll active item into view
  useEffect(() => {
    if (activeIndex >= 0 && activeItemRef.current) {
      // Use optional chaining for safety
      activeItemRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }
  }, [activeIndex]);

  // --- Filtering and Flattening Logic ---
  const flattenedOptions = useMemo(() => {
    // Add safety checks
    if (!options || typeof options !== 'object') return [];

    const flatList = [];
    const lowerCaseSearchTerm = searchTerm.toLowerCase();

    // Use Object.values safely
    Object.values(options).forEach(items => {
        // Ensure items is an array
        if (Array.isArray(items)) {
             items.forEach(item => {
                 // Ensure item and item.label are valid before accessing
                 const label = typeof item?.label === 'string' ? item.label : '';
                 if (!searchTerm || label.toLowerCase().includes(lowerCaseSearchTerm)) {
                     // Only push valid items
                     if (item && typeof item.value !== 'undefined') {
                         flatList.push({ ...item, label }); // Ensure label is the potentially corrected one
                     }
                 }
             });
        }
    });
    return flatList;
  }, [options, searchTerm]); // Keep dependencies

  const getRenderedOptions = () => {
    // Add safety checks
    if (!options || typeof options !== 'object') return {};

     const lowerCaseSearchTerm = searchTerm.toLowerCase();
     const filtered = {};
     Object.entries(options).forEach(([category, items]) => {
        if (Array.isArray(items)) { // Check if items is an array
             const matchingItems = items.filter(item => {
                const label = typeof item?.label === 'string' ? item.label : '';
                // Ensure item is valid before checking label
                return item && (!searchTerm || label.toLowerCase().includes(lowerCaseSearchTerm));
             });
             if (matchingItems.length > 0) {
                 filtered[category] = matchingItems;
             }
        }
     });
     return filtered;
  };

  const renderedOptions = getRenderedOptions();
  const noResults = Object.keys(renderedOptions).length === 0 && searchTerm !== '';
  // --- End Filtering ---

  const handleOptionClick = (optionValue) => {
    onChange(optionValue);
    setIsOpen(false);
    setSearchTerm('');
  };

  const toggleDropdown = () => {
    const nextIsOpen = !isOpen;
    setIsOpen(nextIsOpen);
     if (!nextIsOpen) { // If closing
         setSearchTerm('');
         setActiveIndex(-1);
     }
  };

  const handleSearchChange = (event) => {
    setSearchTerm(event.target.value);
    setActiveIndex(-1); // Reset active index when search changes
  };

  // --- Keyboard Navigation Handler ---
  const handleKeyDown = (event) => {
    // If the event target is the search input and the key is Space,
    // let the browser handle it normally (typing a space).
    if (event.target === searchInputRef.current && event.key === ' ') {
      // Do nothing here, allowing the default action.
    } else if (isOpen) { // Process other keys only if the dropdown is open
        // Use the safe flattenedOptions length
        const count = flattenedOptions.length;
        // Prevent errors if count is 0
        if (count === 0 && (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter')) {
            event.preventDefault();
            return;
        }

        switch (event.key) {
          case 'ArrowDown':
            event.preventDefault();
            setActiveIndex((prevIndex) => (prevIndex + 1) % count);
            break;

          case 'ArrowUp':
            event.preventDefault();
            setActiveIndex((prevIndex) => (prevIndex - 1 + count) % count);
            break;

          case 'Enter':
            event.preventDefault();
            // Ensure activeIndex is valid and flattenedOptions[activeIndex] exists
            if (activeIndex >= 0 && activeIndex < count && flattenedOptions[activeIndex]) {
              handleOptionClick(flattenedOptions[activeIndex].value);
            } else if (activeIndex === -1 && count > 0 && flattenedOptions[0]) {
              // Ensure first option exists
              handleOptionClick(flattenedOptions[0].value);
            }
            break;

          case 'Escape':
            event.preventDefault();
            setIsOpen(false);
            setSearchTerm('');
            setActiveIndex(-1);
            break;

           case 'Tab':
             // Allow tabbing out, close dropdown
             setIsOpen(false);
             setSearchTerm('');
             setActiveIndex(-1);
             break;

          default:
            // Reset active index if typing in search while an item is highlighted
            if (event.target === searchInputRef.current && activeIndex !== -1) {
               // Only reset if it's a character input, not modifier keys etc.
               if (event.key.length === 1) setActiveIndex(-1);
            }
            break;
        }
    } // End of isOpen check
  };

  // --- Assign ref to active item ---
  const assignActiveRef = (el, index) => {
     if (index === activeIndex) {
        activeItemRef.current = el;
     }
  };

  return (
    <SelectWrapper ref={wrapperRef} onKeyDown={handleKeyDown}>
      <SelectTrigger
        type="button"
        onClick={toggleDropdown}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        id={id ? `${id}-trigger` : undefined}
      >
        {selectedIconSrc && <img src={selectedIconSrc} alt="" className="trigger-icon" />}
        <span className="trigger-label">{selectedItemName}</span>
      </SelectTrigger>

      {isOpen && (
        <OptionsList
          ref={optionsListRef}
          role="listbox"
          id={`${id}-listbox`}
          $isOpen={isOpen}
        >
          <SearchInputWrapper>
             <input
                ref={searchInputRef}
                type="text"
                className="search-input"
                placeholder="Search..."
                value={searchTerm}
                onChange={handleSearchChange}
                onClick={(e) => e.stopPropagation()}
                aria-activedescendant={activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined}
             />
          </SearchInputWrapper>

          {noResults ? (
             <OptionItem as="div" className="no-results">No results found</OptionItem>
          ) : (
             (() => {
               let flatIndex = -1;
               // Ensure renderedOptions is an object before trying to map
               return typeof renderedOptions === 'object' && renderedOptions !== null ? Object.entries(renderedOptions).map(([category, items]) => (
            <React.Fragment key={category}>
              <CategoryHeader as="div">{category.charAt(0).toUpperCase() + category.slice(1)}</CategoryHeader>
                    {/* Ensure items is an array */}
                   {Array.isArray(items) ? items.map((item) => {
                     // Ensure item is valid before trying to render
                     if (!item || typeof item.value === 'undefined') return null;

                     flatIndex = flattenedOptions.findIndex(flatItem => flatItem?.value === item.value);
                     // Ensure flatIndex is found
                     if (flatIndex === -1) return null;

                     const isActive = flatIndex === activeIndex;
                     const itemIconSrc = getIconSrc(item.value, allItemsData, fallbackIconImport); // Use helper

                     return (
                <OptionItem
                  key={item.value}
                         ref={(el) => isActive && assignActiveRef(el, flatIndex)}
                         className={isActive ? 'active' : ''}
                  onClick={() => handleOptionClick(item.value)}
                  role="option"
                         aria-selected={item.value === value} // Mark current selection
                         id={`${id}-option-${flatIndex}`} // Use safe id
                       >
                         {/* Use itemIconSrc */}
                         {itemIconSrc && <img src={itemIconSrc} alt="" />}
                         {/* Ensure label is a string */}
                         <span>{typeof item.label === 'string' ? item.label : ''}</span>
                </OptionItem>
                     );
                   }) : null}
            </React.Fragment>
               )) : null; // Return null if renderedOptions is not an object
             })()
          )}
        </OptionsList>
      )}
    </SelectWrapper>
  );
};

// Add defaultProps for safety
CustomIconSelect.defaultProps = {
  id: 'custom-select',
};

CustomIconSelect.propTypes = {
  id: PropTypes.string, // Now optional due to defaultProp
  value: PropTypes.string.isRequired,
  options: PropTypes.objectOf(
    PropTypes.arrayOf(
      PropTypes.shape({
        value: PropTypes.string.isRequired,
        label: PropTypes.string,
      })
    )
  ),
  allItemsData: PropTypes.object.isRequired, // Receives data with iconName strings
  onChange: PropTypes.func.isRequired,
};

export default CustomIconSelect;