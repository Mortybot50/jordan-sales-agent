import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export type ProductBrand = 'purezza' | 'culligan' | 'zip' | 'other'

export interface Product {
  id: string
  brand: ProductBrand
  sku: string
  label: string
  category: string
  weekly_price_aud: number
  default_term_months: number
  default_commission_pct: number
  water_types: string[]
  active: boolean
  notes: string | null
}

export function useProducts() {
  return useQuery({
    queryKey: ['products'],
    queryFn: async (): Promise<Product[]> => {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('active', true)
        .order('brand')
        .order('weekly_price_aud')

      if (error) throw error
      return (data ?? []).map((p) => ({
        ...p,
        brand: p.brand as ProductBrand,
        weekly_price_aud: Number(p.weekly_price_aud),
        default_term_months: Number(p.default_term_months),
        default_commission_pct: Number(p.default_commission_pct),
      }))
    },
    staleTime: 5 * 60 * 1000,
  })
}

export function brandLabel(brand: ProductBrand): string {
  switch (brand) {
    case 'purezza': return 'Purezza'
    case 'culligan': return 'Culligan'
    case 'zip': return 'Zip HydroTap'
    case 'other': return 'Other'
  }
}
