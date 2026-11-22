export type EquipmentCondition =
  | 'جاهزة للعمل'
  | 'قيد الصيانة'
  | 'متوقفة - بانتظار'
  | 'خارجة عن الخدمة';

export type EquipmentCategory =
  | 'آليات ثقيلة'
  | 'رافعات'
  | 'مولدات كهربائية'
  | 'ضواغط هواء'
  | 'معدات لحام'
  | 'سيارات خدمة'
  | 'أجهزة قياس'
  | 'أخرى';

export interface TeamNote {
  id: string;
  workspaceKey?: string;
  equipmentId?: string;
  authorUid?: string;
  author: string;
  role: 'admin' | 'member';
  text: string;
  createdAt: string;
}

export interface EquipmentItem {
  id: string;
  workspaceKey?: string;
  name: string;
  equipmentNumber: string;
  category: EquipmentCategory;
  condition: EquipmentCondition;
  location: string;
  entryDate: string;
  expectedExitDate: string;
  delayServices: boolean;
  delayServicesNote: string;
  delaySpareParts: boolean;
  delaySparePartsNote: string;
  delayOther: boolean;
  delayOtherNote: string;
  finalExitDate?: string;
  teamNotes: TeamNote[];
  createdByUid?: string;
  createdBy: string;
  lastUpdatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface EquipmentInput {
  name: string;
  equipmentNumber: string;
  category: EquipmentCategory;
  condition: EquipmentCondition;
  location: string;
  entryDate: string;
  expectedExitDate: string;
  delayServices: boolean;
  delayServicesNote: string;
  delaySpareParts: boolean;
  delaySparePartsNote: string;
  delayOther: boolean;
  delayOtherNote: string;
  finalExitDate: string;
}

export interface CloudBackupSnapshot {
  id: string;
  workspaceKey?: string;
  label: string;
  createdByUid?: string;
  createdBy: string;
  createdAt: string;
  itemCount: number;
  items: EquipmentItem[];
}

export const EQUIPMENT_CATEGORIES: EquipmentCategory[] = [
  'آليات ثقيلة',
  'رافعات',
  'مولدات كهربائية',
  'ضواغط هواء',
  'معدات لحام',
  'سيارات خدمة',
  'أجهزة قياس',
  'أخرى',
];

export const EQUIPMENT_CONDITIONS: EquipmentCondition[] = [
  'جاهزة للعمل',
  'قيد الصيانة',
  'متوقفة - بانتظار',
  'خارجة عن الخدمة',
];

export type OrgAssetStatus =
  | 'يعمل - حالة جيدة'
  | 'بحاجة لصيانة'
  | 'معطل'
  | 'خارج الخدمة';

export const ORG_ASSET_STATUSES: OrgAssetStatus[] = [
  'يعمل - حالة جيدة',
  'بحاجة لصيانة',
  'معطل',
  'خارج الخدمة',
];

export interface OrganizationAsset {
  id: string;
  workspaceKey?: string;
  name: string;
  assetNumber: string;
  status: OrgAssetStatus;
  createdByUid?: string;
  createdBy: string;
  lastUpdatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationAssetInput {
  name: string;
  assetNumber: string;
  status: OrgAssetStatus;
}

