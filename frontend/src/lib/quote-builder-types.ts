export interface QuoteBuilderPricingItem {
  carcase_core: string;
  carcase_finish: string;
  shutter_core: string;
  shutter_finish: string;
  price: number;
}

export interface QuoteBuilderConfig {
  id: string;
  modules_by_group: Record<string, string[]>;
  pricing_items: QuoteBuilderPricingItem[];
}
