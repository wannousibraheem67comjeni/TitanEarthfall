/** How a procedural person looks: build, clothes, head covering, colours. */
export interface Look {
  build: 'man' | 'woman' | 'boy' | 'old';
  outfit: 'kandura' | 'abaya' | 'casual' | 'apron' | 'overalls' | 'tunic';
  skin: string;
  primary: string;
  secondary: string;
  head: 'ghutra' | 'shayla' | 'cap' | 'hair' | 'kufi';
  headColor: string;
  beard: 'full' | 'short' | 'moustache' | 'none';
  beardColor: string;
  height: number;
  glasses?: boolean;
  cane?: boolean;
}
