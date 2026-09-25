using System;using UnityEngine;
/// <summary>Persistent economy service with atomic balance operations for Gold, Credits, Troca, Gems and Cece.</summary>
public sealed class EconomyManager:MonoBehaviour
{
 public static EconomyManager Instance{get;private set;}
 [SerializeField]int startingGold,startingCredits,startingTroca,startingGems,startingCece;
 public int Gold{get{lock(sync)return gold;}}public int Credits{get{lock(sync)return credits;}}public int Troca{get{lock(sync)return troca;}}public int Gems{get{lock(sync)return gems;}}public int Cece{get{lock(sync)return cece;}}
 public event Action Changed;private readonly object sync=new object();private int gold,credits,troca,gems,cece;const string Key="economy.v1";
 [Serializable]struct SaveData{public int gold,credits,troca,gems,cece;}
 private void Awake(){if(Instance&&Instance!=this){Destroy(gameObject);return;}Instance=this;DontDestroyOnLoad(gameObject);Load();}
 public void AddGold(int v)=>Add(ref gold,v);public void AddCredits(int v)=>Add(ref credits,v);public void AddTroca(int v)=>Add(ref troca,v);public void AddGems(int v)=>Add(ref gems,v);public void AddCece(int v)=>Add(ref cece,v);
 /// <summary>Consumes one Credit for an immediate revive.</summary>public bool TryConsumeReviveCredit(){lock(sync){if(credits<=0)return false;credits--;}SaveAndNotify();return true;}
 public bool TrySpendTroca(int v)=>Spend(ref troca,v);public bool TrySpendGold(int v)=>Spend(ref gold,v);public bool TrySpendGems(int v)=>Spend(ref gems,v);public bool TryConsumeCece(int v=1)=>Spend(ref cece,v);
 private void Add(ref int b,int v){if(v<=0)return;lock(sync)b=checked(b+v);SaveAndNotify();}private bool Spend(ref int b,int v){if(v<0)return false;lock(sync){if(b<v)return false;b-=v;}SaveAndNotify();return true;}
 private void SaveAndNotify(){Save();Changed?.Invoke();}
 public void Save(){SaveData d;lock(sync)d=new SaveData{gold=gold,credits=credits,troca=troca,gems=gems,cece=cece};PlayerPrefs.SetString(Key,JsonUtility.ToJson(d));PlayerPrefs.Save();}
 private void Load(){if(!PlayerPrefs.HasKey(Key)){gold=startingGold;credits=startingCredits;troca=startingTroca;gems=startingGems;cece=startingCece;Save();return;}SaveData d=JsonUtility.FromJson<SaveData>(PlayerPrefs.GetString(Key));lock(sync){gold=Mathf.Max(0,d.gold);credits=Mathf.Max(0,d.credits);troca=Mathf.Max(0,d.troca);gems=Mathf.Max(0,d.gems);cece=Mathf.Max(0,d.cece);}}
}