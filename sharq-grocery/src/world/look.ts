/** How a procedural person looks: build, clothes, head covering, colours, face. */
export interface Look {
  build: 'man' | 'woman' | 'boy' | 'girl' | 'old';
  outfit: 'kandura' | 'abaya' | 'shirt' | 'tshirt' | 'uniform' | 'school' | 'dress';
  skin: string;
  /** Top (or robe) and bottom colours. */
  primary: string;
  secondary: string;
  head: 'ghutra' | 'shemagh' | 'shayla' | 'niqab' | 'hijab' | 'hair' | 'longhair' | 'cap' | 'kufi';
  headColor: string;
  hairColor: string;
  beard: 'full' | 'trim' | 'goatee' | 'moustache' | 'none';
  beardColor: string;
  height: number;
  /** 0 slim … 1 heavy. */
  weight: number;
  shoes: 'sandals' | 'sneakers' | 'formal';
  glasses?: boolean;
  cane?: boolean;
  backpack?: boolean;
}
