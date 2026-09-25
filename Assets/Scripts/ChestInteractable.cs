using System;using UnityEngine;
/// <summary>Troca-gated chest using a weighted loot table for Gems and limited Cece artifacts.</summary>
public sealed class ChestInteractable:MonoBehaviour
{
 [Serializable]public struct LootEntry{public int gems,cece;[Min(.001f)]public float weight;}
 [SerializeField,Min(0)]int trocaCost=10;[SerializeField]LootEntry[] lootTable={new LootEntry{gems=10,cece=0,weight=65},new LootEntry{gems=25,cece=1,weight=25},new LootEntry{gems=50,cece=2,weight=10}};[SerializeField]bool oneTimeUse=true;
 public bool IsOpened{get;private set;}public event Action<LootEntry> LootAwarded;
 /// <summary>Attempts to open the chest for a player.</summary>public bool TryOpen(GameObject player){if(IsOpened||player==null||!EconomyManager.Instance)return false;if(!EconomyManager.Instance.TrySpendTroca(trocaCost))return false;LootEntry l=Roll();EconomyManager.Instance.AddGems(l.gems);EconomyManager.Instance.AddCece(l.cece);IsOpened=oneTimeUse;LootAwarded?.Invoke(l);return true;}
 private LootEntry Roll(){if(lootTable==null||lootTable.Length==0)return default;float total=0;foreach(var e in lootTable)total+=Mathf.Max(0,e.weight);if(total<=0)return lootTable[UnityEngine.Random.Range(0,lootTable.Length)];float r=UnityEngine.Random.value*total;foreach(var e in lootTable){r-=Mathf.Max(0,e.weight);if(r<=0)return e;}return lootTable[lootTable.Length-1];}
}